"""Telemetry Health & Adaptive Strictness Engine (`steadygate/health.py`).

Phase 3: Rolling-window telemetry evaluator tracking:
  1. Frame brightness (computed immediately from frame, then raw frame discarded)
  2. Wrist jitter (inter-frame wrist displacement)
  3. Tracking FPS (from monotonic timestamps)
  4. Detection reliability (valid hand presence & landmark quality rate)

Includes a dual-threshold Hysteresis Engine outputting GOOD / DEGRADED / POOR.
All thresholds in `config.yaml` are explicitly labeled `"heuristic, tuned via Chaos Lab"`.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
import math
from typing import Any

import numpy as np

from steadygate.config import is_feature_enabled, load_config
from steadygate.events import HealthLevel, Observation
from steadygate.policy import SteadyGatePolicy


@dataclass(frozen=True)
class TelemetrySnapshot:
    """Rolling telemetry metrics and hysteresis health evaluation."""

    health_level: HealthLevel
    composite_score: float
    mean_brightness: float
    mean_wrist_jitter: float
    tracking_fps: float
    detection_reliability: float
    samples_n: int
    threshold_provenance: str = "heuristic, tuned via Chaos Lab"

    @property
    def level(self) -> str:
        return self.health_level.value

    def to_dict(self) -> dict[str, Any]:
        return {
            "health_level": self.health_level.value,
            "level": self.health_level.value,
            "composite_score": round(self.composite_score, 4),
            "mean_brightness": round(self.mean_brightness, 4),
            "mean_wrist_jitter": round(self.mean_wrist_jitter, 4),
            "tracking_fps": round(self.tracking_fps, 2),
            "detection_reliability": round(self.detection_reliability, 4),
            "samples_n": self.samples_n,
            "threshold_provenance": self.threshold_provenance,
        }


class TelemetryHealthEvaluator:
    """Rolling-window telemetry evaluator with dual-threshold hysteresis."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        self.enabled = is_feature_enabled(self.config, "adaptive_health")

        hcfg = self.config.get("health", {})
        self.threshold_provenance: str = str(
            hcfg.get("threshold_provenance", "heuristic, tuned via Chaos Lab")
        )
        self.window_size: int = int(hcfg.get("window_size", 30))
        self.good_to_degraded: float = float(hcfg.get("good_to_degraded_score", 0.65))
        self.degraded_to_good: float = float(hcfg.get("degraded_to_good_score", 0.75))
        self.degraded_to_poor: float = float(hcfg.get("degraded_to_poor_score", 0.38))
        self.poor_to_degraded: float = float(hcfg.get("poor_to_degraded_score", 0.48))

        self.min_brightness: float = float(hcfg.get("min_brightness", 0.25))
        self.max_wrist_jitter: float = float(hcfg.get("max_wrist_jitter", 0.06))
        self.min_fps: float = float(hcfg.get("min_fps", 15.0))
        self.min_detection_rate: float = float(hcfg.get("min_detection_rate", 0.60))

        self._brightness_win: deque[float] = deque(maxlen=self.window_size)
        self._jitter_win: deque[float] = deque(maxlen=self.window_size)
        self._dt_win: deque[float] = deque(maxlen=self.window_size)
        self._detect_win: deque[float] = deque(maxlen=self.window_size)

        self._last_t: float | None = None
        self._last_wrist: tuple[float, float] | None = None
        self.level: HealthLevel = HealthLevel.GOOD

    @staticmethod
    def extract_brightness_and_discard_frame(frame_rgb_or_bgr: np.ndarray | None) -> float:
        """Compute normalized mean brightness in [0.0, 1.0] and immediately discard frame ref."""
        if frame_rgb_or_bgr is None or frame_rgb_or_bgr.size == 0:
            return 0.75
        mean_val = float(np.mean(frame_rgb_or_bgr)) / 255.0
        del frame_rgb_or_bgr
        return max(0.0, min(1.0, mean_val))

    def reset(self) -> None:
        self._brightness_win.clear()
        self._jitter_win.clear()
        self._dt_win.clear()
        self._detect_win.clear()
        self._last_t = None
        self._last_wrist = None
        self.level = HealthLevel.GOOD

    def update(self, t_mono: float, obs: Observation) -> TelemetrySnapshot:
        """Record a single frame observation and compute hysteresis health status."""
        if not self.enabled:
            self.level = HealthLevel.GOOD
            return TelemetrySnapshot(
                health_level=HealthLevel.GOOD,
                composite_score=1.0,
                mean_brightness=obs.brightness,
                mean_wrist_jitter=0.0,
                tracking_fps=30.0,
                detection_reliability=1.0,
                samples_n=1,
                threshold_provenance=self.threshold_provenance,
            )

        if self._last_t is not None and t_mono > self._last_t:
            self._dt_win.append(t_mono - self._last_t)
        self._last_t = t_mono

        if obs.hand_present and self._last_wrist is not None:
            jitter = math.hypot(
                obs.wrist_xy[0] - self._last_wrist[0],
                obs.wrist_xy[1] - self._last_wrist[1],
            )
            self._jitter_win.append(jitter)
        elif not obs.hand_present:
            self._jitter_win.append(self.max_wrist_jitter)
        else:
            self._jitter_win.append(0.0)

        self._last_wrist = obs.wrist_xy if obs.hand_present else None
        self._brightness_win.append(max(0.0, min(1.0, float(obs.brightness))))

        detected_ok = (
            1.0
            if (obs.hand_present and obs.landmark_quality >= 0.50 and obs.score >= 0.50)
            else 0.0
        )
        self._detect_win.append(detected_ok)

        mean_brightness = sum(self._brightness_win) / len(self._brightness_win)
        mean_jitter = sum(self._jitter_win) / len(self._jitter_win) if self._jitter_win else 0.0
        mean_dt = sum(self._dt_win) / len(self._dt_win) if self._dt_win else (1.0 / 30.0)
        fps = 1.0 / max(1e-6, mean_dt)
        detect_rel = sum(self._detect_win) / len(self._detect_win)

        # Normalize each component to [0, 1]
        b_score = max(0.0, min(1.0, mean_brightness / max(1e-6, self.min_brightness * 1.6)))
        j_score = max(
            0.0, min(1.0, 1.0 - (mean_jitter / max(1e-6, self.max_wrist_jitter * 1.5)))
        )
        f_score = max(0.0, min(1.0, fps / max(1e-6, self.min_fps * 1.5)))
        d_score = max(0.0, min(1.0, detect_rel / max(1e-6, self.min_detection_rate * 1.25)))

        composite = 0.25 * b_score + 0.30 * j_score + 0.20 * f_score + 0.25 * d_score

        # Apply dual-threshold hysteresis transitions
        self.level = self._apply_hysteresis(composite)

        return TelemetrySnapshot(
            health_level=self.level,
            composite_score=composite,
            mean_brightness=mean_brightness,
            mean_wrist_jitter=mean_jitter,
            tracking_fps=fps,
            detection_reliability=detect_rel,
            samples_n=len(self._brightness_win),
            threshold_provenance=self.threshold_provenance,
        )

    def _apply_hysteresis(self, score: float) -> HealthLevel:
        if self.level == HealthLevel.GOOD:
            if score < self.degraded_to_poor:
                return HealthLevel.POOR
            if score < self.good_to_degraded:
                return HealthLevel.DEGRADED
            return HealthLevel.GOOD

        if self.level == HealthLevel.DEGRADED:
            if score >= self.degraded_to_good:
                return HealthLevel.GOOD
            if score < self.degraded_to_poor:
                return HealthLevel.POOR
            return HealthLevel.DEGRADED

        # Currently POOR
        if score >= self.degraded_to_good:
            return HealthLevel.GOOD
        if score >= self.poor_to_degraded:
            return HealthLevel.DEGRADED
        return HealthLevel.POOR

    def evaluate_and_step(
        self,
        policy: SteadyGatePolicy,
        t_mono: float,
        frame_id: int,
        obs: Observation,
    ) -> tuple[TelemetrySnapshot, Any]:
        """Update rolling health telemetry, sync health level to policy, and step policy."""
        snap = self.update(t_mono, obs)
        policy.set_health_level(snap.health_level)
        event = policy.step(t_mono, frame_id, obs)
        return snap, event


TelemetryHealthMonitor = TelemetryHealthEvaluator
