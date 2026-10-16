"""Dynamic Environmental Adaptation & Noise Suppression Engine (`steadygate/adaptation.py`).

Maintains a 90-frame sliding telemetry window to track environmental stability:
1. Variable Lighting & Contrast: Scales MediaPipe `min_detection_confidence` baseline by a
   step multiplier of `0.15` under low lux or variable lighting.
2. Background Color Interference: Measures background Shannon entropy and isolates target
   hand tracking matrices from static background color fields.
3. User Hand Tremor Filtering: Detects micro-oscillations, applies an Exponential Moving
   Average (EMA) filter on 21-point landmark trajectories, and dynamically scales required
   gesture hold time via `hold_required = hold_baseline * (1.0 + tremor_coefficient)`.
4. Intent Verification Matrix: Evaluates the 75% score boundary (`0.75 * min_score <= score < min_score`)
   to trigger `AMBIGUOUS_STATE` and query the Face Tracking engine instead of hard rejection.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
from typing import Any

import numpy as np

from steadygate.config import load_config


@dataclass(frozen=True)
class AdaptationSnapshot:
    """Telemetry snapshot emitted by the 90-frame Environmental Adaptation Engine."""

    window_fill: int
    window_capacity: int
    mean_brightness: float
    brightness_std: float
    low_or_variable_lighting: bool
    base_min_detection_confidence: float
    active_min_detection_confidence: float
    confidence_step_multiplier: float
    background_entropy: float
    tremor_coefficient: float
    ema_alpha: float
    ambiguous_boundary_ratio: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "window_fill": self.window_fill,
            "window_capacity": self.window_capacity,
            "mean_brightness": round(self.mean_brightness, 6),
            "brightness_std": round(self.brightness_std, 6),
            "low_or_variable_lighting": self.low_or_variable_lighting,
            "base_min_detection_confidence": round(self.base_min_detection_confidence, 6),
            "active_min_detection_confidence": round(self.active_min_detection_confidence, 6),
            "confidence_step_multiplier": round(self.confidence_step_multiplier, 6),
            "background_entropy": round(self.background_entropy, 6),
            "tremor_coefficient": round(self.tremor_coefficient, 6),
            "ema_alpha": round(self.ema_alpha, 4),
            "ambiguous_boundary_ratio": round(self.ambiguous_boundary_ratio, 4),
        }


def compute_background_entropy(rgb_frame: np.ndarray | None) -> float:
    """Compute normalized Shannon color entropy in [0.0, 1.0] across an RGB frame."""
    if rgb_frame is None or rgb_frame.size == 0:
        return 0.0
    gray = np.mean(rgb_frame, axis=-1).astype(np.uint8) if rgb_frame.ndim == 3 else rgb_frame.astype(np.uint8)
    hist, _ = np.histogram(gray, bins=32, range=(0, 256))
    total = float(np.sum(hist))
    if total <= 0.0:
        return 0.0
    probs = hist[hist > 0].astype(np.float64) / total
    entropy = -float(np.sum(probs * np.log2(probs)))
    max_entropy = math.log2(32.0)
    return round(max(0.0, min(1.0, entropy / max_entropy)), 6)


def isolate_hand_from_background(
    landmarks: list[tuple[float, float, float]],
    background_color_field: np.ndarray | None = None,
    background_entropy: float = 0.0,
) -> tuple[list[tuple[float, float, float]], float]:
    """Isolate target 21-point hand tracking matrix from static background color fields.

    Returns (isolated_landmarks, suppression_gain) where static background color dominance
    clamps out-of-bounds peripheral jitter while preserving hand geometry.
    """
    if not landmarks:
        return ([], 0.0)

    entropy = (
        compute_background_entropy(background_color_field)
        if background_color_field is not None
        else float(background_entropy)
    )
    # Static background color field has low entropy; apply stronger peripheral clamping
    suppression_gain = round(max(0.05, min(0.95, 1.0 - 0.5 * entropy)), 6)
    isolated: list[tuple[float, float, float]] = []
    for x, y, z in landmarks:
        ix = max(0.0, min(1.0, float(x)))
        iy = max(0.0, min(1.0, float(y)))
        iz = float(z) * (1.0 - 0.15 * suppression_gain)
        isolated.append((round(ix, 6), round(iy, 6), round(iz, 6)))
    return (isolated, suppression_gain)


class EnvironmentalAdaptationEngine:
    """90-frame sliding history window engine for lighting, background, and tremor adaptation."""

    WINDOW_SIZE = 90
    STEP_MULTIPLIER = 0.15
    AMBIGUOUS_BOUNDARY_RATIO = 0.75

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        adapt_cfg = self.config.get("adaptation", {})

        self.window_size: int = int(adapt_cfg.get("window_size", self.WINDOW_SIZE))
        self.base_confidence: float = float(
            adapt_cfg.get("base_min_detection_confidence", 0.45)
        )
        self.step_multiplier: float = float(
            adapt_cfg.get("low_lux_step_multiplier", self.STEP_MULTIPLIER)
        )
        self.low_lux_threshold: float = float(adapt_cfg.get("low_lux_threshold", 0.35))
        self.lighting_variance_threshold: float = float(
            adapt_cfg.get("lighting_variance_threshold", 0.08)
        )
        self.ema_alpha: float = float(adapt_cfg.get("ema_alpha", 0.35))
        self.ambiguous_boundary_ratio: float = float(
            adapt_cfg.get("ambiguous_boundary_ratio", self.AMBIGUOUS_BOUNDARY_RATIO)
        )

        self._brightness_window: deque[float] = deque(maxlen=self.window_size)
        self._entropy_window: deque[float] = deque(maxlen=self.window_size)
        self._wrist_window: deque[tuple[float, float]] = deque(maxlen=self.window_size)
        self._oscillation_window: deque[float] = deque(maxlen=self.window_size)
        self._ema_landmarks: list[tuple[float, float, float]] | None = None

    def reset(self) -> None:
        """Clear the 90-frame sliding history buffers and EMA state."""
        self._brightness_window.clear()
        self._entropy_window.clear()
        self._wrist_window.clear()
        self._oscillation_window.clear()
        self._ema_landmarks = None

    def filter_landmarks_ema(
        self,
        landmarks: list[tuple[float, float, float]] | None,
    ) -> list[tuple[float, float, float]] | None:
        """Apply an Exponential Moving Average (EMA) filter on 21-point landmark trajectories."""
        if not landmarks:
            self._ema_landmarks = None
            return landmarks

        if self._ema_landmarks is None or len(self._ema_landmarks) != len(landmarks):
            self._ema_landmarks = [
                (round(float(pt[0]), 6), round(float(pt[1]), 6), round(float(pt[2]), 6))
                for pt in landmarks
            ]
            return list(self._ema_landmarks)

        alpha = self.ema_alpha
        smoothed: list[tuple[float, float, float]] = []
        for prev, cur in zip(self._ema_landmarks, landmarks):
            sx = alpha * float(cur[0]) + (1.0 - alpha) * prev[0]
            sy = alpha * float(cur[1]) + (1.0 - alpha) * prev[1]
            sz = alpha * float(cur[2]) + (1.0 - alpha) * prev[2]
            smoothed.append((round(sx, 6), round(sy, 6), round(sz, 6)))

        self._ema_landmarks = smoothed
        return list(smoothed)

    def update(
        self,
        brightness: float = 0.75,
        wrist_xy: tuple[float, float] | None = None,
        landmarks: list[tuple[float, float, float]] | None = None,
        rgb_frame: np.ndarray | None = None,
        background_entropy: float | None = None,
        explicit_tremor_coefficient: float | None = None,
    ) -> AdaptationSnapshot:
        """Record a frame into the 90-frame sliding window and return the updated adaptation state."""
        b_val = max(0.0, min(1.0, float(brightness)))
        self._brightness_window.append(b_val)

        ent_val = (
            float(background_entropy)
            if background_entropy is not None
            else compute_background_entropy(rgb_frame)
        )
        self._entropy_window.append(max(0.0, min(1.0, ent_val)))

        if wrist_xy is None and landmarks and len(landmarks) > 0:
            wrist_xy = (float(landmarks[0][0]), float(landmarks[0][1]))

        if wrist_xy is not None:
            if len(self._wrist_window) >= 1:
                prev_w = self._wrist_window[-1]
                delta = math.hypot(float(wrist_xy[0]) - prev_w[0], float(wrist_xy[1]) - prev_w[1])
                self._oscillation_window.append(delta)
            self._wrist_window.append((float(wrist_xy[0]), float(wrist_xy[1])))

        if explicit_tremor_coefficient is not None and explicit_tremor_coefficient > 0.0:
            self._oscillation_window.append(float(explicit_tremor_coefficient) / 8.0)

        return self.snapshot(explicit_tremor_coefficient=explicit_tremor_coefficient)

    def compute_active_detection_confidence(self) -> tuple[float, bool]:
        """Scale MediaPipe min_detection_confidence by step multiplier 0.15 under low/variable lux."""
        if not self._brightness_window:
            return (round(self.base_confidence, 6), False)

        b_arr = np.asarray(self._brightness_window, dtype=np.float64)
        mean_lux = float(np.mean(b_arr))
        std_lux = float(np.std(b_arr))

        low_or_variable = (
            mean_lux < self.low_lux_threshold or std_lux > self.lighting_variance_threshold
        )
        if low_or_variable:
            # Scale baseline by step multiplier of 0.15
            scaled = min(0.95, self.base_confidence * (1.0 + self.step_multiplier))
            return (round(scaled, 6), True)
        return (round(self.base_confidence, 6), False)

    def compute_tremor_coefficient(
        self,
        explicit_override: float | None = None,
    ) -> float:
        """Compute normalized hand tremor coefficient >= 0.0 from micro-oscillations in the 90-frame window."""
        if explicit_override is not None and explicit_override > 0.0:
            return round(max(0.0, min(2.0, float(explicit_override))), 6)

        if len(self._oscillation_window) < 2:
            return 0.0

        osc = np.asarray(self._oscillation_window, dtype=np.float64)
        mean_delta = float(np.mean(osc))
        # Micro-oscillations above natural stillness floor (0.004) scale tremor_coefficient
        excess = max(0.0, mean_delta - 0.004)
        coeff = min(1.5, excess * 8.0)
        return round(coeff, 6)

    def compute_hold_required(
        self,
        hold_baseline: float,
        tremor_coefficient: float | None = None,
    ) -> float:
        """Dynamically scale required gesture hold time:

        hold_required = hold_baseline * (1.0 + tremor_coefficient)
        """
        coeff = (
            float(tremor_coefficient)
            if tremor_coefficient is not None
            else self.compute_tremor_coefficient()
        )
        return round(float(hold_baseline) * (1.0 + max(0.0, coeff)), 6)

    def classify_score_boundary(
        self,
        score: float,
        min_score: float,
        landmark_quality: float = 1.0,
        min_landmark_quality: float = 0.50,
    ) -> str:
        """Evaluate Intent Verification Matrix boundary:

        - 'PASS': score >= min_score and landmark_quality >= min_landmark_quality
        - 'AMBIGUOUS_STATE': score < min_score (or quality < min_landmark_quality) but within
          75% boundary (score >= 0.75 * min_score and landmark_quality >= 0.75 * min_landmark_quality)
        - 'REJECT': below 75% boundary
        """
        if score >= min_score and landmark_quality >= min_landmark_quality:
            return "PASS"

        ambiguous_score_floor = round(self.ambiguous_boundary_ratio * min_score, 6)
        ambiguous_quality_floor = round(self.ambiguous_boundary_ratio * min_landmark_quality, 6)
        if score >= ambiguous_score_floor and landmark_quality >= ambiguous_quality_floor:
            return "AMBIGUOUS_STATE"
        return "REJECT"

    def snapshot(self, explicit_tremor_coefficient: float | None = None) -> AdaptationSnapshot:
        """Return the current 90-frame EnvironmentalAdaptationEngine telemetry snapshot."""
        if self._brightness_window:
            b_arr = np.asarray(self._brightness_window, dtype=np.float64)
            mean_b = float(np.mean(b_arr))
            std_b = float(np.std(b_arr))
        else:
            mean_b = 0.75
            std_b = 0.0

        mean_ent = (
            float(np.mean(self._entropy_window)) if self._entropy_window else 0.0
        )
        active_conf, low_or_var = self.compute_active_detection_confidence()
        tremor_coeff = self.compute_tremor_coefficient(explicit_override=explicit_tremor_coefficient)

        return AdaptationSnapshot(
            window_fill=len(self._brightness_window),
            window_capacity=self.window_size,
            mean_brightness=round(mean_b, 6),
            brightness_std=round(std_b, 6),
            low_or_variable_lighting=low_or_var,
            base_min_detection_confidence=round(self.base_confidence, 6),
            active_min_detection_confidence=active_conf,
            confidence_step_multiplier=self.step_multiplier,
            background_entropy=round(mean_ent, 6),
            tremor_coefficient=tremor_coeff,
            ema_alpha=self.ema_alpha,
            ambiguous_boundary_ratio=self.ambiguous_boundary_ratio,
        )
