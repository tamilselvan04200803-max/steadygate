"""Core telemetry schema: DecisionEvent, Observation, ReasonCode, and Privacy-Safe ML Payload."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
import json
from typing import Any

import numpy as np


class ReasonCode(str, Enum):
    """Strict 18-value reason code enumeration for SteadyGate 2.0."""

    NO_HAND = "NO_HAND"
    OUTSIDE_ZONE = "OUTSIDE_ZONE"
    LOW_SCORE = "LOW_SCORE"
    UNKNOWN_GESTURE = "UNKNOWN_GESTURE"
    STALE_OBSERVATION = "STALE_OBSERVATION"
    TIMESTAMP_GAP = "TIMESTAMP_GAP"
    HOLD_TOO_SHORT = "HOLD_TOO_SHORT"
    NOT_RELEASED = "NOT_RELEASED"
    TARGET_CHANGED = "TARGET_CHANGED"
    TIMEOUT = "TIMEOUT"
    USER_CANCEL = "USER_CANCEL"
    HEALTH_STRICT = "HEALTH_STRICT"
    HEALTH_LOCKED = "HEALTH_LOCKED"
    AMBIGUOUS_TARGET = "AMBIGUOUS_TARGET"
    ACK_MISSING = "ACK_MISSING"
    OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN"
    USER_DISTRACTED = "USER_DISTRACTED"
    DEVICE_FAULT_LOCK = "DEVICE_FAULT_LOCK"


class DecisionType(str, Enum):
    """Decision outcomes for each evaluated frame."""

    ACCEPT = "ACCEPT"
    HOLD = "HOLD"
    COMMIT = "COMMIT"
    REJECT = "REJECT"
    CANCEL = "CANCEL"


class HealthLevel(str, Enum):
    """Telemetry health tiers."""

    GOOD = "GOOD"
    DEGRADED = "DEGRADED"
    POOR = "POOR"


class RiskTier(str, Enum):
    """Device risk tiers."""

    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class PolicyState(str, Enum):
    """Pure state-machine states for SteadyGatePolicy."""

    IDLE = "IDLE"
    ARMED = "ARMED"
    REQUESTING = "REQUESTING"
    AMBIGUOUS_STATE = "AMBIGUOUS_STATE"
    HOLDING = "HOLDING"
    AWAITING_RELEASE = "AWAITING_RELEASE"
    AWAITING_CONFIRM = "AWAITING_CONFIRM"


def sanitize_frame_for_ml_storage(rgb_frame: np.ndarray | None) -> dict[str, Any]:
    """PRIVACY SAFEGUARD: Strictly mask, strip, and zero-out raw video array pixels.

    Never saves raw frame data. Computes an in-place zeroed mask verification while
    returning only privacy-safe metadata confirming pixel stripping.
    """
    if rgb_frame is None:
        return {
            "raw_video_pixels_masked": True,
            "pixel_array_stored": False,
            "sanitized_frame_shape": [0, 0, 0],
            "masked_pixel_sum": 0,
        }
    arr = np.asarray(rgb_frame)
    zeroed = np.zeros_like(arr, dtype=np.uint8)
    return {
        "raw_video_pixels_masked": True,
        "pixel_array_stored": False,
        "sanitized_frame_shape": [0, 0, 0],
        "masked_pixel_sum": int(np.sum(zeroed)),
    }


@dataclass(frozen=True)
class Observation:
    """Single-frame vision observation passed into SteadyGatePolicy."""

    gesture: str
    score: float
    hand_present: bool
    landmark_quality: float
    in_zone: bool = field(default=True, compare=False)
    num_hands: int = field(default=1, compare=False)
    wrist_xy: tuple[float, float] = field(default=(0.5, 0.5), compare=False)
    brightness: float = field(default=0.75, compare=False)
    contrast: float = field(default=0.22, compare=False)
    landmarks: list[tuple[float, float, float]] | None = field(default=None, compare=False)
    target_device: str | None = field(default=None, compare=False)
    target_command: str | None = field(default=None, compare=False)
    user_id: str = field(default="user_default", compare=False)
    background_entropy: float = field(default=0.0, compare=False)
    tremor_coefficient: float = field(default=0.0, compare=False)
    active_min_detection_confidence: float = field(default=0.45, compare=False)
    ema_stabilized: bool = field(default=False, compare=False)
    face_detected: bool = field(default=True, compare=False)
    head_yaw_deg: float = field(default=0.0, compare=False)
    head_pitch_deg: float = field(default=0.0, compare=False)
    gaze_xy: tuple[float, float] = field(default=(0.5, 0.5), compare=False)
    gaze_in_zone: bool = field(default=True, compare=False)
    user_intent_verified: bool | None = field(default=None, compare=False)
    aruco_marker_id: int | None = field(default=None, compare=False)
    aruco_anchor_locked: bool | None = field(default=None, compare=False)

    def to_schema_dict(self) -> dict[str, Any]:
        """Serialize to the exact 4-field observation object in Section 4."""
        return {
            "gesture": str(self.gesture),
            "score": round(float(self.score), 6),
            "hand_present": bool(self.hand_present),
            "landmark_quality": round(float(self.landmark_quality), 6),
        }

    def to_dict(self) -> dict[str, Any]:
        """Alias for to_schema_dict."""
        return self.to_schema_dict()

    @classmethod
    def from_schema_dict(cls, data: dict[str, Any]) -> Observation:
        return cls(
            gesture=str(data.get("gesture", "UNKNOWN")),
            score=float(data.get("score", 0.0)),
            hand_present=bool(data.get("hand_present", True)),
            landmark_quality=float(data.get("landmark_quality", 0.9)),
            in_zone=bool(data.get("in_zone", True)),
            num_hands=int(data.get("num_hands", 1)),
        )

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Observation:
        """Alias for from_schema_dict."""
        return cls.from_schema_dict(data)


def build_ml_training_payload(
    t_mono: float,
    frame_id: int,
    observation: Observation,
    raw_frame: np.ndarray | None = None,
) -> dict[str, Any]:
    """Construct the privacy-safe `ml_training_payload` object for continuous ML training."""
    privacy_meta = sanitize_frame_for_ml_storage(raw_frame)
    landmarks_list: list[list[float]] = []
    if observation.landmarks:
        for pt in observation.landmarks:
            landmarks_list.append(
                [round(float(pt[0]), 6), round(float(pt[1]), 6), round(float(pt[2]), 6)]
            )

    return {
        "raw_tracking_data": {
            "landmarks": landmarks_list,
            "detection_confidence": round(float(observation.score), 6),
            "landmark_quality": round(float(observation.landmark_quality), 6),
            "frame_id": int(frame_id),
            "timestamp_mono": round(float(t_mono), 6),
            "aruco_marker_id": observation.aruco_marker_id,
        },
        "user_environment_profile": {
            "user_id": str(observation.user_id),
            "environment_metrics": {
                "lux": round(float(observation.brightness), 6),
                "brightness": round(float(observation.brightness), 6),
                "contrast": round(float(observation.contrast), 6),
                "background_entropy": round(float(observation.background_entropy), 6),
                "tremor_coefficient": round(float(observation.tremor_coefficient), 6),
                "active_min_detection_confidence": round(
                    float(observation.active_min_detection_confidence), 6
                ),
                "ema_stabilized": bool(observation.ema_stabilized),
                "head_yaw_deg": round(float(observation.head_yaw_deg), 4),
                "head_pitch_deg": round(float(observation.head_pitch_deg), 4),
                "user_intent_verified": (
                    True
                    if observation.user_intent_verified is None
                    else bool(observation.user_intent_verified)
                ),
            },
        },
        "privacy_safeguard": privacy_meta,
    }


@dataclass(frozen=True)
class ActionCommand:
    """Explicit absolute SET command emitted upon COMMIT (never TOGGLE)."""

    device_id: str
    command: str
    target_state: str
    risk_tier: str
    simulated: bool = True

    def __post_init__(self) -> None:
        if "TOGGLE" in self.command.upper():
            raise ValueError(
                f"Illegal command '{self.command}': SteadyGate only permits absolute SET commands."
            )
        if not self.command.startswith("SET_"):
            raise ValueError(
                f"Command '{self.command}' must start with 'SET_' (explicit absolute state)."
            )

    def to_dict(self) -> dict[str, Any]:
        return {
            "device_id": self.device_id,
            "command": self.command,
            "target_state": self.target_state,
            "risk_tier": self.risk_tier,
            "simulated": True,
            "label": "simulated",
        }


@dataclass(frozen=True)
class DecisionEvent:
    """Structured telemetry event emitted for every frame processed by SteadyGatePolicy."""

    t_mono: float
    frame_id: int
    observation: Observation
    state_before: str
    state_after: str
    decision: str
    reason_code: str
    hold_elapsed: float
    hold_required: float
    health_level: str
    device_id: str
    risk_tier: str
    action_command: ActionCommand | None = field(default=None, compare=False)
    ml_training_payload: dict[str, Any] | None = field(default=None, compare=False)

    def __post_init__(self) -> None:
        # Validate strict enum memberships
        ReasonCode(self.reason_code)
        DecisionType(self.decision)
        HealthLevel(self.health_level)
        RiskTier(self.risk_tier)
        PolicyState(self.state_before)
        PolicyState(self.state_after)

    def get_ml_training_payload(self) -> dict[str, Any]:
        """Return existing or freshly generated privacy-safe ml_training_payload."""
        if self.ml_training_payload is not None:
            return self.ml_training_payload
        return build_ml_training_payload(
            t_mono=self.t_mono,
            frame_id=self.frame_id,
            observation=self.observation,
        )

    def to_dict(self, include_ml_payload: bool | None = None) -> dict[str, Any]:
        """Serialize to the Section 4 JSONL schema, appending ml_training_payload when enabled."""
        payload: dict[str, Any] = {
            "t_mono": round(float(self.t_mono), 6),
            "frame_id": int(self.frame_id),
            "observation": self.observation.to_schema_dict(),
            "state_before": str(self.state_before),
            "state_after": str(self.state_after),
            "decision": str(self.decision),
            "reason_code": str(self.reason_code),
            "hold_elapsed": round(float(self.hold_elapsed), 6),
            "hold_required": round(float(self.hold_required), 6),
            "health_level": str(self.health_level),
            "device_id": str(self.device_id),
            "risk_tier": str(self.risk_tier),
        }
        should_include = (
            include_ml_payload
            if include_ml_payload is not None
            else (self.ml_training_payload is not None)
        )
        if should_include:
            payload["ml_training_payload"] = self.get_ml_training_payload()
        return payload

    def to_jsonl(self, include_ml_payload: bool | None = None) -> str:
        """Return compact single-line JSON string for JSONL streaming."""
        return json.dumps(self.to_dict(include_ml_payload=include_ml_payload), separators=(",", ":"))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> DecisionEvent:
        required_keys = {
            "t_mono",
            "frame_id",
            "observation",
            "state_before",
            "state_after",
            "decision",
            "reason_code",
            "hold_elapsed",
            "hold_required",
            "health_level",
            "device_id",
            "risk_tier",
        }
        missing = required_keys - set(payload.keys())
        if missing:
            raise ValueError(f"DecisionEvent missing required keys: {sorted(missing)}")

        obs = Observation.from_schema_dict(payload["observation"])
        ml_payload = payload.get("ml_training_payload")
        if ml_payload is not None and isinstance(ml_payload, dict):
            raw_tracking = ml_payload.get("raw_tracking_data", {})
            env_profile = ml_payload.get("user_environment_profile", {})
            env_metrics = env_profile.get("environment_metrics", {})
            raw_lms = raw_tracking.get("landmarks", [])
            parsed_lms = [
                (float(pt[0]), float(pt[1]), float(pt[2]))
                for pt in raw_lms
                if isinstance(pt, (list, tuple)) and len(pt) >= 3
            ]
            obs = Observation(
                gesture=obs.gesture,
                score=obs.score,
                hand_present=obs.hand_present,
                landmark_quality=obs.landmark_quality,
                landmarks=parsed_lms if parsed_lms else None,
                user_id=str(env_profile.get("user_id", "user_default")),
                brightness=float(env_metrics.get("brightness", 0.75)),
                contrast=float(env_metrics.get("contrast", 0.22)),
                background_entropy=float(env_metrics.get("background_entropy", 0.0)),
                tremor_coefficient=float(env_metrics.get("tremor_coefficient", 0.0)),
                active_min_detection_confidence=float(
                    env_metrics.get("active_min_detection_confidence", 0.45)
                ),
                ema_stabilized=bool(env_metrics.get("ema_stabilized", False)),
                head_yaw_deg=float(env_metrics.get("head_yaw_deg", 0.0)),
                head_pitch_deg=float(env_metrics.get("head_pitch_deg", 0.0)),
                user_intent_verified=env_metrics.get("user_intent_verified"),
                aruco_marker_id=raw_tracking.get("aruco_marker_id"),
            )

        return cls(
            t_mono=float(payload["t_mono"]),
            frame_id=int(payload["frame_id"]),
            observation=obs,
            state_before=str(payload["state_before"]),
            state_after=str(payload["state_after"]),
            decision=str(payload["decision"]),
            reason_code=str(payload["reason_code"]),
            hold_elapsed=float(payload["hold_elapsed"]),
            hold_required=float(payload["hold_required"]),
            health_level=str(payload["health_level"]),
            device_id=str(payload["device_id"]),
            risk_tier=str(payload["risk_tier"]),
            ml_training_payload=ml_payload if isinstance(ml_payload, dict) else None,
        )

    @classmethod
    def from_jsonl(cls, line: str) -> DecisionEvent:
        return cls.from_dict(json.loads(line))
