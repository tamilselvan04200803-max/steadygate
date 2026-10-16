"""Vision & MediaPipe Tasks VIDEO-mode interface, strictly segregated from policy.py.

Hard Rule 2: Uses real MediaPipe Tasks outputs in VIDEO mode with monotonic increasing
timestamps; never hardcodes a detected hand as a command.
Hard Rule 3: Kept strictly separate from pure policy (steadygate/policy.py).
Hard Rule 5: Privacy by default — never stores raw video frames. --record stores only
gesture labels, scores, timestamps, and landmarks behind an explicit consent notice.
Integrates the 90-frame EnvironmentalAdaptationEngine, OpenCV ArUco Spatial Anchor
Tracker (`ArucoSpatialAnchorTracker`), and concurrent FaceIntentTracker.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np

from steadygate import REPO_ROOT
from steadygate.adaptation import (
    EnvironmentalAdaptationEngine,
    compute_background_entropy,
    isolate_hand_from_background,
)
from steadygate.aruco_anchor import ArucoSpatialAnchorTracker
from steadygate.config import load_config
from steadygate.events import Observation, sanitize_frame_for_ml_storage
from steadygate.face_intent import FaceIntentTracker

PRIVACY_CONSENT_NOTICE = (
    "PRIVACY CONSENT NOTICE (--record): SteadyGate does NOT store raw video frames. "
    "Enabling --record writes only gesture labels, confidence scores, monotonic timestamps, "
    "and 21-point normalized hand landmarks to a local JSONL file."
)


def _dist2d(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def classify_landmarks(
    landmarks: list[tuple[float, float, float]],
    roi: dict[str, float] | None = None,
) -> tuple[str, float, float, bool, tuple[float, float]]:
    """Classify a 21-point hand landmark array into (gesture, score, landmark_quality, in_zone, wrist_xy).

    Never hardcodes a detected hand as a command: evaluates anatomical finger extension
    ratios and inter-landmark geometry from 21 landmarks.
    """
    if len(landmarks) < 21:
        return ("UNKNOWN", 0.0, 0.0, False, (0.5, 0.5))

    wrist = landmarks[0]
    thumb_mcp, thumb_ip, thumb_tip = landmarks[2], landmarks[3], landmarks[4]
    index_mcp, index_pip, index_tip = landmarks[5], landmarks[6], landmarks[8]
    middle_mcp, middle_pip, middle_tip = landmarks[9], landmarks[10], landmarks[12]
    ring_mcp, ring_pip, ring_tip = landmarks[13], landmarks[14], landmarks[16]
    pinky_mcp, pinky_pip, pinky_tip = landmarks[17], landmarks[18], landmarks[20]

    palm_len = max(_dist2d(wrist, middle_mcp), 0.04)
    palm_width = max(_dist2d(index_mcp, pinky_mcp), 0.03)

    in_bounds = all(0.0 <= pt[0] <= 1.0 and 0.0 <= pt[1] <= 1.0 for pt in landmarks)
    scale_ok = 0.05 <= palm_len <= 0.55 and 0.04 <= palm_width <= 0.50
    landmark_quality = 0.92 if (in_bounds and scale_ok) else (0.65 if in_bounds else 0.35)

    roi_box = roi or {"x_min": 0.10, "x_max": 0.90, "y_min": 0.10, "y_max": 0.90}
    cx, cy = middle_mcp[0], middle_mcp[1]
    in_zone = (
        roi_box["x_min"] <= cx <= roi_box["x_max"]
        and roi_box["y_min"] <= cy <= roi_box["y_max"]
    )

    def finger_ext(
        mcp: tuple[float, float, float],
        pip: tuple[float, float, float],
        tip: tuple[float, float, float],
    ) -> float:
        reach = (_dist2d(wrist, tip) / palm_len - 1.05) / 0.85
        tip_over_pip = (_dist2d(wrist, tip) - _dist2d(wrist, pip)) / (0.45 * palm_len)
        return max(0.0, min(1.0, 0.55 * reach + 0.45 * tip_over_pip))

    idx_e = finger_ext(index_mcp, index_pip, index_tip)
    mid_e = finger_ext(middle_mcp, middle_pip, middle_tip)
    rng_e = finger_ext(ring_mcp, ring_pip, ring_tip)
    pnk_e = finger_ext(pinky_mcp, pinky_pip, pinky_tip)

    thumb_abduct = max(
        0.0, min(1.0, (_dist2d(thumb_tip, index_mcp) / palm_len - 0.30) / 0.55)
    )
    thumb_reach = max(
        0.0, min(1.0, (_dist2d(wrist, thumb_tip) / palm_len - 0.85) / 0.75)
    )
    thm_e = 0.55 * thumb_abduct + 0.45 * thumb_reach

    pinch_dist = _dist2d(thumb_tip, index_tip) / palm_len
    four_curled = (4.0 - (idx_e + mid_e + rng_e + pnk_e)) / 4.0
    thumb_up_vertical = (index_mcp[1] - thumb_tip[1]) / palm_len
    thumb_down_vertical = (thumb_tip[1] - wrist[1]) / palm_len

    scores: dict[str, float] = {
        "OPEN_PALM": (thm_e + idx_e + mid_e + rng_e + pnk_e) / 5.0,
        "CLOSED_FIST": ((5.0 - (thm_e + idx_e + mid_e + rng_e + pnk_e)) / 5.0)
        * (1.0 - max(0.0, min(0.7, max(thumb_up_vertical, thumb_down_vertical)))),
        "POINTING_UP": 0.65 * idx_e + 0.35 * ((3.0 - (mid_e + rng_e + pnk_e)) / 3.0),
        "VICTORY": 0.60 * ((idx_e + mid_e) / 2.0) + 0.40 * ((2.0 - (rng_e + pnk_e)) / 2.0),
        "THUMBS_UP": (
            0.35 * thm_e
            + 0.40 * four_curled
            + 0.25 * max(0.0, min(1.0, thumb_up_vertical / 0.40))
        )
        * (1.0 if thumb_tip[1] < wrist[1] else 0.35),
        "THUMBS_DOWN": (
            0.35 * thm_e
            + 0.40 * four_curled
            + 0.25 * max(0.0, min(1.0, thumb_down_vertical / 0.35))
        )
        * (1.0 if thumb_tip[1] > wrist[1] else 0.30),
        "PINCH": max(0.0, min(1.0, 1.0 - pinch_dist / 0.45)) * ((2.0 - (rng_e + pnk_e)) / 2.0),
    }

    best_gesture, best_score = max(scores.items(), key=lambda kv: kv[1])
    best_score = round(min(0.99, max(0.0, best_score)), 4)
    if best_score < 0.52:
        return ("UNKNOWN", best_score, landmark_quality, in_zone, (wrist[0], wrist[1]))
    return (best_gesture, best_score, landmark_quality, in_zone, (wrist[0], wrist[1]))


def generate_anatomical_landmarks(
    gesture: str,
    cx: float = 0.50,
    cy: float = 0.55,
    jitter_dx: float = 0.0,
    jitter_dy: float = 0.0,
) -> list[tuple[float, float, float]]:
    """Generate deterministic 21-point normalized landmarks for synthetic verification."""
    bx = cx + jitter_dx
    by = cy + jitter_dy
    wrist = (bx, by + 0.18, 0.0)

    ext_map: dict[str, tuple[float, float, float, float, float, str]] = {
        "OPEN_PALM": (0.95, 0.98, 1.00, 0.96, 0.94, "SIDE"),
        "CLOSED_FIST": (0.10, 0.08, 0.08, 0.08, 0.08, "TUCK"),
        "FIST": (0.10, 0.08, 0.08, 0.08, 0.08, "TUCK"),
        "POINTING_UP": (0.15, 0.98, 0.10, 0.08, 0.08, "TUCK"),
        "VICTORY": (0.15, 0.98, 0.96, 0.10, 0.08, "TUCK"),
        "THUMBS_UP": (0.98, 0.10, 0.10, 0.08, 0.08, "UP"),
        "THUMBS_DOWN": (0.98, 0.10, 0.10, 0.08, 0.08, "DOWN"),
        "PINCH": (0.45, 0.45, 0.10, 0.08, 0.08, "PINCH"),
    }
    thm, idx, mid, rng, pnk, mode = ext_map.get(
        gesture, (0.45, 0.45, 0.45, 0.45, 0.45, "TUCK")
    )

    index_mcp = (bx - 0.06, by, 0.0)
    middle_mcp = (bx - 0.01, by - 0.02, 0.0)
    ring_mcp = (bx + 0.04, by, 0.0)
    pinky_mcp = (bx + 0.08, by + 0.03, 0.0)

    thumb_cmc = (bx - 0.09, by + 0.09, 0.0)
    thumb_mcp = (bx - 0.11, by + 0.04, 0.0)
    if mode == "UP":
        thumb_ip = (bx - 0.115, by - 0.04, 0.0)
        thumb_tip = (bx - 0.115, by - 0.12, 0.0)
    elif mode == "DOWN":
        thumb_ip = (bx - 0.115, by + 0.22, 0.0)
        thumb_tip = (bx - 0.115, by + 0.30, 0.0)
    elif mode == "PINCH":
        thumb_ip = (bx - 0.08, by - 0.02, 0.0)
        thumb_tip = (bx - 0.055, by - 0.055, 0.0)
    elif mode == "SIDE":
        thumb_ip = (bx - 0.15, by - 0.01, 0.0)
        thumb_tip = (bx - 0.19, by - 0.05, 0.0)
    else:
        thumb_ip = (bx - 0.08, by + 0.02, 0.0)
        thumb_tip = (bx - 0.05, by + 0.03, 0.0)

    def build_finger(
        mcp: tuple[float, float, float], angle_deg: float, ext: float
    ) -> list[tuple[float, float, float]]:
        if mode == "PINCH" and mcp == index_mcp:
            return [
                mcp,
                (bx - 0.06, by - 0.04, 0.0),
                (bx - 0.058, by - 0.05, 0.0),
                (bx - 0.055, by - 0.055, 0.0),
            ]
        curl = 1.0 - max(0.0, min(1.0, ext))
        segs = [0.075, 0.055, 0.045]
        bends = [curl * 1.75, curl * 1.40, curl * 0.90]
        heading = math.radians(angle_deg)
        pts = [mcp]
        cur_x, cur_y = mcp[0], mcp[1]
        for seg, bend in zip(segs, bends):
            heading += bend
            cur_x += math.sin(heading) * seg
            cur_y -= math.cos(heading) * seg
            pts.append((round(cur_x, 6), round(cur_y, 6), 0.0))
        return pts

    return [
        wrist,
        thumb_cmc,
        thumb_mcp,
        thumb_ip,
        thumb_tip,
        *build_finger(index_mcp, -8.0, idx),
        *build_finger(middle_mcp, 0.0, mid),
        *build_finger(ring_mcp, 8.0, rng),
        *build_finger(pinky_mcp, 16.0, pnk),
    ]


class LandmarkRecordLogger:
    """Privacy-by-default landmark & gesture stream logger (--record).

    Hard Rule 5: Never writes raw video frames. Requires explicit --record and consent.
    """

    def __init__(self, output_path: Path, consent_acknowledged: bool = False) -> None:
        if not consent_acknowledged:
            raise PermissionError(
                f"{PRIVACY_CONSENT_NOTICE}\nConsent must be acknowledged (--consent) before recording."
            )
        self.output_path = Path(output_path)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

    def write_observation(
        self,
        t_mono: float,
        frame_id: int,
        obs: Observation,
        rgb_frame: np.ndarray | None = None,
    ) -> None:
        privacy_meta = sanitize_frame_for_ml_storage(rgb_frame)
        record = {
            "t_mono": round(float(t_mono), 6),
            "frame_id": int(frame_id),
            "gesture": obs.gesture,
            "score": round(float(obs.score), 6),
            "hand_present": bool(obs.hand_present),
            "landmark_quality": round(float(obs.landmark_quality), 6),
            "landmarks": obs.landmarks or [],
            "raw_video_stored": False,
            "privacy_safeguard": privacy_meta,
        }
        with self.output_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, separators=(",", ":")) + "\n")


class MediaPipeVideoTracker:
    """Real MediaPipe Tasks HandLandmarker wrapper in VIDEO mode with 90-frame adaptation, OpenCV ArUco, & concurrent face intent."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        model_rel = self.config.get("paths", {}).get(
            "model_asset", "public/models/hand_landmarker.task"
        )
        self.model_path = (REPO_ROOT / Path(model_rel)).resolve()
        if not self.model_path.exists():
            raise FileNotFoundError(f"Local MediaPipe model asset not found at {self.model_path}")

        self.roi = self.config.get("policy", {}).get(
            "roi", {"x_min": 0.10, "x_max": 0.90, "y_min": 0.10, "y_max": 0.90}
        )
        self.adaptation = EnvironmentalAdaptationEngine(self.config)
        self.face_tracker = FaceIntentTracker(self.config)
        self.aruco_tracker = ArucoSpatialAnchorTracker(self.config)
        self._active_min_detection_confidence: float = self.adaptation.base_confidence
        self._last_timestamp_ms: int | None = None
        self._landmarker: Any = None

    def _ensure_landmarker(self, min_detection_confidence: float | None = None) -> Any:
        target_conf = round(
            float(min_detection_confidence or self._active_min_detection_confidence), 4
        )
        if (
            self._landmarker is not None
            and abs(target_conf - self._active_min_detection_confidence) >= 0.01
        ):
            try:
                self._landmarker.close()
            except Exception:
                pass
            self._landmarker = None

        self._active_min_detection_confidence = target_conf
        if self._landmarker is None:
            from mediapipe.tasks import python as mp_python
            from mediapipe.tasks.python import vision as mp_vision

            base_opts = mp_python.BaseOptions(model_asset_path=str(self.model_path))
            opts = mp_vision.HandLandmarkerOptions(
                base_options=base_opts,
                running_mode=mp_vision.RunningMode.VIDEO,
                num_hands=2,
                min_hand_detection_confidence=self._active_min_detection_confidence,
                min_hand_presence_confidence=self._active_min_detection_confidence,
                min_tracking_confidence=self._active_min_detection_confidence,
            )
            self._landmarker = mp_vision.HandLandmarker.create_from_options(opts)
        return self._landmarker

    def process_frame(self, rgb_frame: np.ndarray, t_mono: float) -> Observation:
        """Run MediaPipe Tasks VIDEO detection + ArUco anchor detection + 90-frame adaptation + Face Intent on an RGB frame."""
        timestamp_ms = int(round(t_mono * 1000.0))
        if self._last_timestamp_ms is not None and timestamp_ms <= self._last_timestamp_ms:
            raise ValueError(
                f"MediaPipe VIDEO mode requires strictly monotonically increasing timestamps: "
                f"got {timestamp_ms}ms after {self._last_timestamp_ms}ms"
            )
        self._last_timestamp_ms = timestamp_ms

        aruco_dets = self.aruco_tracker.detect_markers(rgb_frame)
        detected_marker_id = aruco_dets[0].marker_id if aruco_dets else None

        brightness = float(np.mean(rgb_frame) / 255.0) if rgb_frame.size > 0 else 0.0
        contrast = float(np.std(rgb_frame) / 255.0) if rgb_frame.size > 0 else 0.0
        bg_entropy = compute_background_entropy(rgb_frame)
        face_res = self.face_tracker.process_frame(rgb_frame, target_zone=self.roi)

        adapt_snap = self.adaptation.update(
            brightness=brightness,
            rgb_frame=rgb_frame,
            background_entropy=bg_entropy,
        )

        try:
            import mediapipe as mp

            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            landmarker = self._ensure_landmarker(
                min_detection_confidence=adapt_snap.active_min_detection_confidence
            )
            result = landmarker.detect_for_video(mp_image, timestamp_ms)
        except (ImportError, OSError, RuntimeError):
            result = None

        # Strictly strip raw video array pixels after inference
        sanitize_frame_for_ml_storage(rgb_frame)

        if result is None or not getattr(result, "hand_landmarks", None):
            return Observation(
                gesture="UNKNOWN",
                score=0.0,
                hand_present=False,
                landmark_quality=0.0,
                in_zone=False,
                num_hands=0,
                brightness=round(brightness, 4),
                contrast=round(contrast, 4),
                landmarks=[],
                background_entropy=adapt_snap.background_entropy,
                tremor_coefficient=adapt_snap.tremor_coefficient,
                active_min_detection_confidence=adapt_snap.active_min_detection_confidence,
                ema_stabilized=False,
                face_detected=face_res.face_detected,
                head_yaw_deg=face_res.head_yaw_deg,
                head_pitch_deg=face_res.head_pitch_deg,
                gaze_xy=face_res.gaze_xy,
                gaze_in_zone=face_res.gaze_in_zone,
                user_intent_verified=face_res.user_intent_verified,
                aruco_marker_id=detected_marker_id,
            )

        num_hands = len(result.hand_landmarks)
        first_hand = result.hand_landmarks[0]
        raw_pts: list[tuple[float, float, float]] = [
            (float(lm.x), float(lm.y), float(getattr(lm, "z", 0.0))) for lm in first_hand
        ]
        isolated_pts, _ = isolate_hand_from_background(
            raw_pts, background_entropy=adapt_snap.background_entropy
        )
        smoothed_pts = self.adaptation.filter_landmarks_ema(isolated_pts) or isolated_pts
        gesture, score, quality, in_zone, wrist_xy = classify_landmarks(
            smoothed_pts, roi=self.roi
        )
        adapt_snap = self.adaptation.update(
            brightness=brightness,
            wrist_xy=wrist_xy,
            landmarks=smoothed_pts,
            background_entropy=adapt_snap.background_entropy,
        )
        return Observation(
            gesture=gesture,
            score=score,
            hand_present=True,
            landmark_quality=quality,
            in_zone=in_zone,
            num_hands=num_hands,
            wrist_xy=wrist_xy,
            brightness=round(brightness, 4),
            contrast=round(contrast, 4),
            landmarks=smoothed_pts,
            background_entropy=adapt_snap.background_entropy,
            tremor_coefficient=adapt_snap.tremor_coefficient,
            active_min_detection_confidence=adapt_snap.active_min_detection_confidence,
            ema_stabilized=True,
            face_detected=face_res.face_detected,
            head_yaw_deg=face_res.head_yaw_deg,
            head_pitch_deg=face_res.head_pitch_deg,
            gaze_xy=face_res.gaze_xy,
            gaze_in_zone=face_res.gaze_in_zone,
            user_intent_verified=face_res.user_intent_verified,
            aruco_marker_id=detected_marker_id,
        )

    def close(self) -> None:
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None
        self.face_tracker.close()
