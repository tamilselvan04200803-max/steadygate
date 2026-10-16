"""Pure-Python State-Machine Policy (`steadygate/policy.py`).

Hard Rule 3: Zero direct camera/OpenCV/MediaPipe/network I/O. Driven strictly by a
monotonic clock (`t_mono >= 0.0`) and `Observation` inputs.
Integrates:
1. Intent Locking & False-Positive Trigger Suppression:
   - Mitigation Gate 1: ArUco Spatial Anchor Locking (`ArucoSpatialAnchorTracker`,
     mapping duplicate appliances such as `lamp` [ID 10] and `lamp_2` [ID 11]).
   - Mitigation Gate 2: Face/Gaze Intent Match (`FaceIntentTracker`, `USER_DISTRACTED`).
2. Ampere-Load Dynamic Hand Gesture Timing Matrix:
   `hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)`
   (`0.35s` for Low-Ampere `lamp`/`lamp_2`/`curtain`; `1.20s–1.80s` for High-Ampere `fan`/`heater`).
3. Continuous ML Training Pipeline (`ml_training_payload` in every `DecisionEvent`).
4. Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK` with decision `CANCEL`).
"""

from __future__ import annotations

from typing import Any

from steadygate.adaptation import EnvironmentalAdaptationEngine
from steadygate.actuator import COMMAND_TO_STATE, VirtualActuator
from steadygate.aruco_anchor import ArucoSpatialAnchorTracker
from steadygate.config import load_config
from steadygate.events import (
    ActionCommand,
    DecisionEvent,
    DecisionType,
    HealthLevel,
    Observation,
    PolicyState,
    ReasonCode,
    RiskTier,
    build_ml_training_payload,
)
from steadygate.face_intent import FaceIntentTracker
from steadygate.recovery import CIRCUIT_BREAKER_ALERT_MESSAGE, get_recovery_message

# Default deterministic mapping from request gesture -> (device_id, SET command)
GESTURE_ACTION_MAP: dict[str, tuple[str, str]] = {
    "POINTING_UP": ("lamp", "SET_ON"),
    "THUMBS_DOWN": ("lamp", "SET_OFF"),
    "VICTORY": ("fan", "SET_SPEED_2"),
    "PINCH": ("curtain", "SET_OPEN"),
    "ILOVEYOU": ("curtain", "SET_CLOSED"),
    "THUMBS_UP": ("heater", "SET_ON"),
}

NEUTRAL_RELEASE_GESTURES: set[str] = {"OPEN_PALM", "NEUTRAL", "NONE"}
CANCEL_GESTURES: set[str] = {"CLOSED_FIST", "FIST"}
CONFIRM_GESTURE: str = "THUMBS_UP"


class SteadyGatePolicy:
    """Pure state-machine policy implementing arm -> request -> hold -> release -> confirm."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        actuator: VirtualActuator | None = None,
        adaptation: EnvironmentalAdaptationEngine | None = None,
        face_tracker: FaceIntentTracker | None = None,
        aruco_tracker: ArucoSpatialAnchorTracker | None = None,
        *,
        use_ampere_load_matrix: bool = False,
    ) -> None:
        self.config = config or load_config()
        self.actuator = actuator or VirtualActuator(self.config)
        self.adaptation = adaptation or EnvironmentalAdaptationEngine(self.config)
        self.face_tracker = face_tracker or FaceIntentTracker(self.config)
        self.aruco_tracker = aruco_tracker or ArucoSpatialAnchorTracker(self.config)
        self.use_ampere_load_matrix = bool(use_ampere_load_matrix)

        pol_cfg = self.config.get("policy", {})
        self.min_score: float = float(pol_cfg.get("min_score", 0.70))
        self.min_landmark_quality: float = float(pol_cfg.get("min_landmark_quality", 0.50))
        self.base_hold_sec: float = float(pol_cfg.get("hold_required_sec", 0.80))
        self.confirm_hold_sec: float = float(pol_cfg.get("confirm_hold_required_sec", 0.50))
        self.arm_timeout_sec: float = float(pol_cfg.get("arm_timeout_sec", 4.0))
        self.request_timeout_sec: float = float(pol_cfg.get("request_timeout_sec", 5.0))
        self.release_timeout_sec: float = float(pol_cfg.get("release_timeout_sec", 3.0))
        self.confirm_timeout_sec: float = float(pol_cfg.get("confirm_timeout_sec", 4.0))
        self.max_timestamp_gap_sec: float = float(pol_cfg.get("max_timestamp_gap_sec", 0.50))
        self.risk_tier_hold_sec: dict[str, float] = {
            "LOW": float(pol_cfg.get("risk_tier_hold_sec", {}).get("LOW", self.base_hold_sec)),
            "MEDIUM": float(pol_cfg.get("risk_tier_hold_sec", {}).get("MEDIUM", 1.20)),
            "HIGH": float(pol_cfg.get("risk_tier_hold_sec", {}).get("HIGH", 1.80)),
        }

        self._state: PolicyState = PolicyState.IDLE
        self._health_level: HealthLevel = HealthLevel.GOOD
        self._last_t_mono: float | None = None
        self._state_entered_at: float | None = None
        self._hold_started_at: float | None = None
        self._confirm_started_at: float | None = None

        self._target_gesture: str | None = None
        self._target_device: str = "lamp"
        self._target_command: str = "SET_ON"
        self._target_risk_tier: str = RiskTier.LOW.value
        self._target_aruco_marker_id: int = 10

        self._last_reason_code: ReasonCode = ReasonCode.NO_HAND
        self._last_hold_elapsed: float = 0.0
        self._last_hold_required: float = self.base_hold_sec
        self._last_event: DecisionEvent | None = None
        self._circuit_breaker_alert: str | None = None

    @property
    def state(self) -> str:
        return self._state.value

    @property
    def health_level(self) -> str:
        return self._health_level.value

    @property
    def circuit_breaker_alert(self) -> str | None:
        return self._circuit_breaker_alert

    def set_health_level(self, level: str | HealthLevel) -> None:
        """Update current telemetry health level (GOOD, DEGRADED, POOR)."""
        self._health_level = HealthLevel(level)

    def reset(self) -> None:
        """Reset state machine to IDLE (preserving monotonic clock history)."""
        self._state = PolicyState.IDLE
        self._state_entered_at = None
        self._hold_started_at = None
        self._confirm_started_at = None
        self._target_gesture = None
        self._last_hold_elapsed = 0.0

    def _device_risk_tier(self, device_id: str) -> str:
        if device_id in self.actuator.devices:
            return self.actuator.devices[device_id].risk_tier
        return RiskTier.LOW.value

    def get_load_ampere_class_baseline(self, device_id: str) -> float:
        """Return the hardware electrical `load_ampere_class_baseline` (in seconds) for `device_id`."""
        if device_id in self.actuator.devices:
            return float(self.actuator.devices[device_id].load_ampere_class_baseline)
        dev_spec = self.config.get("devices", {}).get(device_id, {})
        if "load_ampere_class_baseline" in dev_spec:
            return float(dev_spec["load_ampere_class_baseline"])
        return 0.35

    def compute_ampere_hold_required(
        self,
        device_id: str,
        tremor_coefficient: float = 0.0,
    ) -> float:
        """Ampere-Load Dynamic Hand Gesture Timing Matrix formula:

        hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)
        """
        load_baseline = self.get_load_ampere_class_baseline(device_id)
        if self._health_level == HealthLevel.DEGRADED:
            load_baseline = load_baseline * 2.0
        return round(load_baseline * (1.0 + max(0.0, float(tremor_coefficient))), 6)

    def _required_hold_for_device(
        self,
        device_id: str,
        tremor_coefficient: float = 0.0,
    ) -> float:
        if self.use_ampere_load_matrix or device_id == "lamp_2":
            return self.compute_ampere_hold_required(
                device_id=device_id,
                tremor_coefficient=tremor_coefficient,
            )
        risk = self._device_risk_tier(device_id)
        base = self.risk_tier_hold_sec.get(risk, self.base_hold_sec)
        if self._health_level == HealthLevel.DEGRADED:
            base = base * 2.0
        return self.adaptation.compute_hold_required(
            hold_baseline=base,
            tremor_coefficient=tremor_coefficient,
        )

    def _required_confirm_hold(self, tremor_coefficient: float = 0.0) -> float:
        base = self.confirm_hold_sec
        if self._health_level == HealthLevel.DEGRADED:
            base = base * 2.0
        return self.adaptation.compute_hold_required(
            hold_baseline=base,
            tremor_coefficient=tremor_coefficient,
        )

    def _resolve_state_aware_command(
        self,
        dev_id: str,
        gesture: str,
        default_cmd: str,
    ) -> str:
        """Resolve explicit idempotent SET_* command based on current simulated device state."""
        if gesture == "THUMBS_DOWN":
            return "SET_OFF"
        if gesture == "ILOVEYOU":
            return "SET_CLOSED"
        if dev_id not in self.actuator.devices:
            return default_cmd

        cur_state = self.actuator.devices[dev_id].state
        if default_cmd == "SET_ON":
            return "SET_OFF" if cur_state == "ON" else "SET_ON"
        if default_cmd.startswith("SET_SPEED_"):
            return (
                "SET_OFF"
                if cur_state in ("ON", "SPEED_1", "SPEED_2", "SPEED_3")
                else default_cmd
            )
        if default_cmd == "SET_OPEN":
            return "SET_CLOSED" if cur_state == "OPEN" else "SET_OPEN"
        return default_cmd

    def _resolve_target(self, obs: Observation) -> tuple[str, str, str] | None:
        """Return (device_id, command, risk_tier) for a request observation, or None."""
        if obs.target_device and obs.target_command:
            dev_id = obs.target_device
            cmd = obs.target_command
            return (dev_id, cmd, self._device_risk_tier(dev_id))
        if obs.aruco_marker_id is not None and obs.gesture in GESTURE_ACTION_MAP:
            _, default_cmd = GESTURE_ACTION_MAP[obs.gesture]
            spec = self.aruco_tracker.marker_registry.get(int(obs.aruco_marker_id))
            if spec is not None:
                dev_id = str(spec["device_id"])
                cmd = self._resolve_state_aware_command(dev_id, obs.gesture, default_cmd)
                return (dev_id, cmd, self._device_risk_tier(dev_id))
        if obs.gesture == "THUMBS_DOWN":
            for cand_id in ("lamp", "lamp_2", "heater", "fan"):
                if (
                    cand_id in self.actuator.devices
                    and self.actuator.devices[cand_id].state != "OFF"
                ):
                    return (cand_id, "SET_OFF", self._device_risk_tier(cand_id))
            return ("lamp", "SET_OFF", self._device_risk_tier("lamp"))
        if obs.gesture in GESTURE_ACTION_MAP:
            dev_id, default_cmd = GESTURE_ACTION_MAP[obs.gesture]
            cmd = self._resolve_state_aware_command(dev_id, obs.gesture, default_cmd)
            return (dev_id, cmd, self._device_risk_tier(dev_id))
        return None

    def _check_timeout(self, t_mono: float) -> bool:
        if self._state == PolicyState.IDLE or self._state_entered_at is None:
            return False
        elapsed = t_mono - self._state_entered_at
        if self._state == PolicyState.ARMED:
            return elapsed > self.arm_timeout_sec
        if self._state in (
            PolicyState.REQUESTING,
            PolicyState.AMBIGUOUS_STATE,
            PolicyState.HOLDING,
        ):
            return elapsed > self.request_timeout_sec
        if self._state == PolicyState.AWAITING_RELEASE:
            return elapsed > self.release_timeout_sec
        if self._state == PolicyState.AWAITING_CONFIRM:
            return elapsed > self.confirm_timeout_sec
        return False

    @staticmethod
    def _has_face_stream(obs: Observation) -> bool:
        """Return True if active Face Intent telemetry was supplied on the observation."""
        return (
            obs.user_intent_verified is not None
            or obs.head_yaw_deg != 0.0
            or obs.head_pitch_deg != 0.0
            or not obs.gaze_in_zone
            or not obs.face_detected
            or obs.gaze_xy != (0.5, 0.5)
        )

    def _enrich_observation(self, obs: Observation) -> tuple[Observation, float]:
        """Run 90-frame Environmental Adaptation & EMA landmark stabilization on Observation."""
        smoothed_lms = (
            self.adaptation.filter_landmarks_ema(obs.landmarks)
            if obs.landmarks is not None
            else None
        )
        explicit_tremor = obs.tremor_coefficient if obs.tremor_coefficient > 0.0 else None
        snap = self.adaptation.update(
            brightness=obs.brightness,
            wrist_xy=obs.wrist_xy,
            landmarks=smoothed_lms,
            background_entropy=obs.background_entropy if obs.background_entropy > 0.0 else None,
            explicit_tremor_coefficient=explicit_tremor,
        )
        face_res = self.face_tracker.verify_observation(obs)
        tremor_coeff = (
            obs.tremor_coefficient
            if obs.tremor_coefficient > 0.0
            else snap.tremor_coefficient
        )
        enriched = Observation(
            gesture=obs.gesture,
            score=obs.score,
            hand_present=obs.hand_present,
            landmark_quality=obs.landmark_quality,
            in_zone=obs.in_zone,
            num_hands=obs.num_hands,
            wrist_xy=obs.wrist_xy,
            brightness=obs.brightness,
            contrast=obs.contrast,
            landmarks=smoothed_lms,
            target_device=obs.target_device,
            target_command=obs.target_command,
            user_id=obs.user_id,
            background_entropy=(
                obs.background_entropy
                if obs.background_entropy > 0.0
                else snap.background_entropy
            ),
            tremor_coefficient=tremor_coeff,
            active_min_detection_confidence=snap.active_min_detection_confidence,
            ema_stabilized=smoothed_lms is not None,
            face_detected=obs.face_detected,
            head_yaw_deg=obs.head_yaw_deg,
            head_pitch_deg=obs.head_pitch_deg,
            gaze_xy=obs.gaze_xy,
            gaze_in_zone=obs.gaze_in_zone,
            user_intent_verified=face_res.user_intent_verified,
            aruco_marker_id=obs.aruco_marker_id,
            aruco_anchor_locked=obs.aruco_anchor_locked,
        )
        return (enriched, tremor_coeff)

    def _emit(
        self,
        t_mono: float,
        frame_id: int,
        obs: Observation,
        state_before: PolicyState,
        state_after: PolicyState,
        decision: DecisionType,
        reason_code: ReasonCode,
        hold_elapsed: float,
        hold_required: float,
        action_command: ActionCommand | None = None,
    ) -> DecisionEvent:
        self._state = state_after
        self._last_reason_code = reason_code
        self._last_hold_elapsed = round(max(0.0, hold_elapsed), 6)
        self._last_hold_required = round(max(0.0, hold_required), 6)
        ml_payload = build_ml_training_payload(
            t_mono=t_mono,
            frame_id=frame_id,
            observation=obs,
        )
        event = DecisionEvent(
            t_mono=t_mono,
            frame_id=frame_id,
            observation=obs,
            state_before=state_before.value,
            state_after=state_after.value,
            decision=decision.value,
            reason_code=reason_code.value,
            hold_elapsed=self._last_hold_elapsed,
            hold_required=self._last_hold_required,
            health_level=self._health_level.value,
            device_id=self._target_device,
            risk_tier=self._target_risk_tier,
            action_command=action_command,
            ml_training_payload=ml_payload,
        )
        self._last_event = event
        return event

    def step(self, t_mono: float, frame_id: int, obs: Observation) -> DecisionEvent:
        """Evaluate a single frame observation at monotonic timestamp `t_mono`."""
        state_before = self._state
        face_stream_active = self._has_face_stream(obs)
        enriched_obs, tremor_coeff = self._enrich_observation(obs)
        self.actuator.check_auto_expire(t_mono)

        cur_hold_req = (
            self._required_confirm_hold(tremor_coeff)
            if state_before == PolicyState.AWAITING_CONFIRM
            else self._required_hold_for_device(self._target_device, tremor_coeff)
        )

        # 1. Monotonic clock checks (`is not None` so t_mono == 0.0 works cleanly)
        if self._last_t_mono is not None:
            dt = round(t_mono - self._last_t_mono, 6)
            if dt <= 0.0:
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    state_before,
                    DecisionType.REJECT,
                    ReasonCode.STALE_OBSERVATION,
                    self._last_hold_elapsed,
                    cur_hold_req,
                )
            if dt > self.max_timestamp_gap_sec and state_before != PolicyState.IDLE:
                self._last_t_mono = t_mono
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.CANCEL,
                    ReasonCode.TIMESTAMP_GAP,
                    0.0,
                    cur_hold_req,
                )
        self._last_t_mono = t_mono

        # 2. Telemetry health POOR lock
        if self._health_level == HealthLevel.POOR:
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.HEALTH_LOCKED,
                0.0,
                cur_hold_req,
            )

        # 3. State timeout check
        if self._check_timeout(t_mono):
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.CANCEL,
                ReasonCode.TIMEOUT,
                0.0,
                cur_hold_req,
            )

        # 4. Presence, multi-hand ambiguity, ROI zone, and ArUco Spatial Anchor Lock checks
        if not enriched_obs.hand_present:
            if state_before in (
                PolicyState.REQUESTING,
                PolicyState.AMBIGUOUS_STATE,
                PolicyState.HOLDING,
                PolicyState.AWAITING_CONFIRM,
            ):
                self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                self._state,
                DecisionType.REJECT,
                ReasonCode.NO_HAND,
                0.0,
                cur_hold_req,
            )

        if enriched_obs.num_hands > 1:
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.AMBIGUOUS_TARGET,
                0.0,
                cur_hold_req,
            )

        # Mitigation Gate 1: ArUco Spatial Anchor Locking
        if enriched_obs.aruco_anchor_locked is False or not enriched_obs.in_zone:
            if state_before in (
                PolicyState.REQUESTING,
                PolicyState.AMBIGUOUS_STATE,
                PolicyState.HOLDING,
                PolicyState.AWAITING_CONFIRM,
            ):
                self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                self._state,
                DecisionType.REJECT,
                ReasonCode.OUTSIDE_ZONE,
                0.0,
                cur_hold_req,
            )

        if enriched_obs.aruco_marker_id is not None:
            anchor_check = self.aruco_tracker.verify_spatial_anchor_lock(
                target_device=self._target_device,
                landmarks=enriched_obs.landmarks,
                wrist_xy=enriched_obs.wrist_xy,
                explicit_marker_id=enriched_obs.aruco_marker_id,
                explicit_lock=enriched_obs.aruco_anchor_locked,
            )
            if not anchor_check.locked:
                if state_before in (
                    PolicyState.REQUESTING,
                    PolicyState.AMBIGUOUS_STATE,
                    PolicyState.HOLDING,
                    PolicyState.AWAITING_CONFIRM,
                ):
                    self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    self._state,
                    DecisionType.REJECT,
                    ReasonCode.OUTSIDE_ZONE,
                    0.0,
                    cur_hold_req,
                )

        # 5. Explicit user cancel gesture (CLOSED_FIST / FIST) from any active state
        if enriched_obs.gesture in CANCEL_GESTURES and enriched_obs.score >= self.min_score:
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.CANCEL,
                ReasonCode.USER_CANCEL,
                0.0,
                cur_hold_req,
            )

        # 6. Score & landmark quality gate with 75% AMBIGUOUS_STATE Intent Verification Matrix
        boundary_status = self.adaptation.classify_score_boundary(
            score=enriched_obs.score,
            min_score=self.min_score,
            landmark_quality=enriched_obs.landmark_quality,
            min_landmark_quality=self.min_landmark_quality,
        )
        if boundary_status == "REJECT" or (
            boundary_status == "AMBIGUOUS_STATE" and not face_stream_active
        ):
            if state_before in (
                PolicyState.REQUESTING,
                PolicyState.AMBIGUOUS_STATE,
                PolicyState.HOLDING,
                PolicyState.AWAITING_CONFIRM,
            ):
                self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                self._state,
                DecisionType.REJECT,
                ReasonCode.LOW_SCORE,
                0.0,
                cur_hold_req,
            )

        if boundary_status == "AMBIGUOUS_STATE":
            face_res = self.face_tracker.verify_observation(enriched_obs)
            if not face_res.user_intent_verified:
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    ReasonCode.USER_DISTRACTED,
                    0.0,
                    cur_hold_req,
                )
            if state_before == PolicyState.ARMED:
                resolved = self._resolve_target(enriched_obs)
                if resolved is not None:
                    dev_id, cmd, risk = resolved
                    self._target_gesture = enriched_obs.gesture
                    self._target_device = dev_id
                    self._target_command = cmd
                    self._target_risk_tier = risk
                    self._target_aruco_marker_id = (
                        int(enriched_obs.aruco_marker_id)
                        if enriched_obs.aruco_marker_id is not None
                        else self.aruco_tracker.device_to_marker.get(dev_id, 10)
                    )
                    self._state_entered_at = t_mono
                    self._hold_started_at = t_mono
                    req = self._required_hold_for_device(dev_id, tremor_coeff)
                    return self._emit(
                        t_mono,
                        frame_id,
                        enriched_obs,
                        state_before,
                        PolicyState.AMBIGUOUS_STATE,
                        DecisionType.HOLD,
                        ReasonCode.HOLD_TOO_SHORT,
                        0.0,
                        req,
                    )

        # 7. State-specific transitions
        if state_before == PolicyState.IDLE:
            if enriched_obs.gesture == "OPEN_PALM":
                self._state_entered_at = t_mono
                reason = (
                    ReasonCode.HEALTH_STRICT
                    if self._health_level == HealthLevel.DEGRADED
                    else ReasonCode.HOLD_TOO_SHORT
                )
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.ARMED,
                    DecisionType.ACCEPT,
                    reason,
                    0.0,
                    cur_hold_req,
                )
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.UNKNOWN_GESTURE,
                0.0,
                cur_hold_req,
            )

        if state_before == PolicyState.ARMED:
            if enriched_obs.gesture == "OPEN_PALM":
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.ARMED,
                    DecisionType.HOLD,
                    ReasonCode.HOLD_TOO_SHORT,
                    0.0,
                    cur_hold_req,
                )

            resolved = self._resolve_target(enriched_obs)
            if resolved is None:
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.ARMED,
                    DecisionType.REJECT,
                    ReasonCode.UNKNOWN_GESTURE,
                    0.0,
                    cur_hold_req,
                )

            dev_id, cmd, risk = resolved
            # High-risk actions (e.g., Heater) require GOOD health exclusively
            if risk == RiskTier.HIGH.value and self._health_level != HealthLevel.GOOD:
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    ReasonCode.HEALTH_LOCKED,
                    0.0,
                    self._required_hold_for_device(dev_id, tremor_coeff),
                )

            self._target_gesture = enriched_obs.gesture
            self._target_device = dev_id
            self._target_command = cmd
            self._target_risk_tier = risk
            self._target_aruco_marker_id = (
                int(enriched_obs.aruco_marker_id)
                if enriched_obs.aruco_marker_id is not None
                else self.aruco_tracker.device_to_marker.get(dev_id, 10)
            )
            self._state_entered_at = t_mono
            self._hold_started_at = t_mono
            req = self._required_hold_for_device(dev_id, tremor_coeff)
            reason = (
                ReasonCode.HEALTH_STRICT
                if self._health_level == HealthLevel.DEGRADED
                else ReasonCode.HOLD_TOO_SHORT
            )
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.REQUESTING,
                DecisionType.ACCEPT,
                reason,
                0.0,
                req,
            )

        if state_before in (
            PolicyState.REQUESTING,
            PolicyState.AMBIGUOUS_STATE,
            PolicyState.HOLDING,
        ):
            req = self._required_hold_for_device(self._target_device, tremor_coeff)
            if enriched_obs.gesture != self._target_gesture:
                reason = (
                    ReasonCode.HOLD_TOO_SHORT
                    if enriched_obs.gesture in NEUTRAL_RELEASE_GESTURES
                    else ReasonCode.TARGET_CHANGED
                )
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    reason,
                    0.0,
                    req,
                )

            # Strict Face Intent Verification Gate during HOLD progression
            face_res = self.face_tracker.verify_observation(enriched_obs)
            if not face_res.user_intent_verified:
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    ReasonCode.USER_DISTRACTED,
                    0.0,
                    req,
                )

            hold_start = self._hold_started_at if self._hold_started_at is not None else t_mono
            elapsed = max(0.0, t_mono - hold_start)
            if elapsed >= req:
                self._state_entered_at = t_mono
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.AWAITING_RELEASE,
                    DecisionType.ACCEPT,
                    ReasonCode.NOT_RELEASED,
                    elapsed,
                    req,
                )

            reason = (
                ReasonCode.HEALTH_STRICT
                if self._health_level == HealthLevel.DEGRADED
                else ReasonCode.HOLD_TOO_SHORT
            )
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.HOLDING,
                DecisionType.HOLD,
                reason,
                elapsed,
                req,
            )

        if state_before == PolicyState.AWAITING_RELEASE:
            req = self._required_hold_for_device(self._target_device, tremor_coeff)
            if enriched_obs.gesture in NEUTRAL_RELEASE_GESTURES:
                self._state_entered_at = t_mono
                self._confirm_started_at = None
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.AWAITING_CONFIRM,
                    DecisionType.ACCEPT,
                    ReasonCode.HOLD_TOO_SHORT,
                    0.0,
                    self._required_confirm_hold(tremor_coeff),
                )
            if enriched_obs.gesture == self._target_gesture:
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.AWAITING_RELEASE,
                    DecisionType.HOLD,
                    ReasonCode.NOT_RELEASED,
                    req,
                    req,
                )
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.TARGET_CHANGED,
                0.0,
                req,
            )

        if state_before == PolicyState.AWAITING_CONFIRM:
            conf_req = self._required_confirm_hold(tremor_coeff)
            if enriched_obs.gesture in NEUTRAL_RELEASE_GESTURES:
                if self._confirm_started_at is not None:
                    self.reset()
                    return self._emit(
                        t_mono,
                        frame_id,
                        enriched_obs,
                        state_before,
                        PolicyState.IDLE,
                        DecisionType.REJECT,
                        ReasonCode.HOLD_TOO_SHORT,
                        0.0,
                        conf_req,
                    )
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.AWAITING_CONFIRM,
                    DecisionType.HOLD,
                    ReasonCode.HOLD_TOO_SHORT,
                    0.0,
                    conf_req,
                )

            if enriched_obs.gesture != CONFIRM_GESTURE:
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    ReasonCode.TARGET_CHANGED,
                    0.0,
                    conf_req,
                )

            # Strict Face Intent Check Gate before HOLD -> SET transition
            face_res = self.face_tracker.verify_observation(enriched_obs)
            if not face_res.user_intent_verified:
                self.reset()
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.REJECT,
                    ReasonCode.USER_DISTRACTED,
                    0.0,
                    conf_req,
                )

            if self._confirm_started_at is None:
                self._confirm_started_at = t_mono
                return self._emit(
                    t_mono,
                    frame_id,
                    enriched_obs,
                    state_before,
                    PolicyState.AWAITING_CONFIRM,
                    DecisionType.HOLD,
                    ReasonCode.HOLD_TOO_SHORT,
                    0.0,
                    conf_req,
                )

            elapsed = max(0.0, t_mono - self._confirm_started_at)
            if elapsed >= conf_req:
                return self._commit(t_mono, frame_id, enriched_obs, state_before, elapsed, conf_req)

            return self._emit(
                t_mono,
                frame_id,
                enriched_obs,
                state_before,
                PolicyState.AWAITING_CONFIRM,
                DecisionType.HOLD,
                ReasonCode.HOLD_TOO_SHORT,
                elapsed,
                conf_req,
            )

        return self._emit(
            t_mono,
            frame_id,
            enriched_obs,
            state_before,
            PolicyState.IDLE,
            DecisionType.REJECT,
            ReasonCode.UNKNOWN_GESTURE,
            0.0,
            cur_hold_req,
        )

    def _commit(
        self,
        t_mono: float,
        frame_id: int,
        obs: Observation,
        state_before: PolicyState,
        elapsed: float,
        conf_req: float,
    ) -> DecisionEvent:
        """Execute final checks and dispatch absolute SET command via VirtualActuator."""
        if (
            self._target_risk_tier == RiskTier.HIGH.value
            and self._health_level != HealthLevel.GOOD
        ):
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.HEALTH_LOCKED,
                elapsed,
                conf_req,
            )

        # Strict Intent Check Gate: verify Face Tracking intent before SET commit
        face_res = self.face_tracker.verify_observation(obs)
        if not face_res.user_intent_verified:
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                ReasonCode.USER_DISTRACTED,
                elapsed,
                conf_req,
            )

        # Actuator Health Circuit Breaker: query simulated status register BEFORE issuing SET packet
        tripped, alert_msg = self.actuator.check_circuit_breaker(self._target_device)
        if tripped:
            self._circuit_breaker_alert = alert_msg or CIRCUIT_BREAKER_ALERT_MESSAGE
            self.reset()
            return self._emit(
                t_mono,
                frame_id,
                obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.CANCEL,
                ReasonCode.DEVICE_FAULT_LOCK,
                elapsed,
                conf_req,
                action_command=None,
            )

        self._circuit_breaker_alert = None
        target_state = COMMAND_TO_STATE.get(self._target_command, "ON")
        action = ActionCommand(
            device_id=self._target_device,
            command=self._target_command,
            target_state=target_state,
            risk_tier=self._target_risk_tier,
            simulated=True,
        )
        result = self.actuator.execute(action, t_mono=t_mono)
        self.reset()

        if not result.ok:
            fail_reason = ReasonCode(result.reason_code or ReasonCode.ACK_MISSING.value)
            if fail_reason == ReasonCode.DEVICE_FAULT_LOCK:
                self._circuit_breaker_alert = (
                    result.alert_message or CIRCUIT_BREAKER_ALERT_MESSAGE
                )
                return self._emit(
                    t_mono,
                    frame_id,
                    obs,
                    state_before,
                    PolicyState.IDLE,
                    DecisionType.CANCEL,
                    fail_reason,
                    elapsed,
                    conf_req,
                    action_command=None,
                )
            return self._emit(
                t_mono,
                frame_id,
                obs,
                state_before,
                PolicyState.IDLE,
                DecisionType.REJECT,
                fail_reason,
                elapsed,
                conf_req,
                action_command=action,
            )

        return self._emit(
            t_mono,
            frame_id,
            obs,
            state_before,
            PolicyState.IDLE,
            DecisionType.COMMIT,
            ReasonCode.NOT_RELEASED,
            elapsed,
            conf_req,
            action_command=action,
        )

    def describe(self) -> dict[str, Any]:
        """Expose current state, hold progress, active thresholds, ArUco anchor, next actions, and recovery string."""
        next_actions_map: dict[PolicyState, list[str]] = {
            PolicyState.IDLE: ["Show OPEN_PALM in zone to arm"],
            PolicyState.ARMED: [
                "POINTING_UP -> lamp:SET_ON (ArUco ID 10 / 11)",
                "THUMBS_DOWN -> lamp:SET_OFF",
                "VICTORY -> fan:SET_SPEED_2 (ArUco ID 20)",
                "PINCH -> curtain:SET_OPEN (ArUco ID 30)",
                "THUMBS_UP -> heater:SET_ON (ArUco ID 40)",
                "CLOSED_FIST -> Cancel",
            ],
            PolicyState.REQUESTING: [
                f"Hold {self._target_gesture} steady ({self._last_hold_required:.2f}s)",
                "CLOSED_FIST -> Cancel",
            ],
            PolicyState.AMBIGUOUS_STATE: [
                f"Ambiguous score (75% boundary): Keep facing camera (+/-20 deg) & hold {self._target_gesture}",
                "CLOSED_FIST -> Cancel",
            ],
            PolicyState.HOLDING: [
                f"Keep holding {self._target_gesture} ({self._last_hold_elapsed:.2f}/{self._last_hold_required:.2f}s)",
                "CLOSED_FIST -> Cancel",
            ],
            PolicyState.AWAITING_RELEASE: [
                "Relax hand to neutral OPEN_PALM to release",
                "CLOSED_FIST -> Cancel",
            ],
            PolicyState.AWAITING_CONFIRM: [
                f"Hold THUMBS_UP for {self._required_confirm_hold():.2f}s to confirm {self._target_device}:{self._target_command}",
                "CLOSED_FIST -> Cancel",
            ],
        }
        ratio = (
            min(1.0, self._last_hold_elapsed / self._last_hold_required)
            if self._last_hold_required > 0.0
            else 0.0
        )
        adapt_snap = self.adaptation.snapshot()
        face_snap = self.face_tracker.last_result
        anchor_spec = self.aruco_tracker.marker_registry.get(
            self._target_aruco_marker_id,
            {
                "marker_id": self._target_aruco_marker_id,
                "device_id": self._target_device,
                "label": self._target_device,
                "bbox": (0.15, 0.15, 0.85, 0.85),
            },
        )
        return {
            "current_state": self._state.value,
            "hold_progress": {
                "elapsed": round(self._last_hold_elapsed, 4),
                "required": round(self._last_hold_required, 4),
                "ratio": round(ratio, 4),
            },
            "active_thresholds": {
                "min_score": self.min_score,
                "ambiguous_min_score": round(0.75 * self.min_score, 4),
                "min_landmark_quality": self.min_landmark_quality,
                "hold_required_sec": round(self._last_hold_required, 4),
                "load_ampere_class_baseline_sec": round(
                    self.get_load_ampere_class_baseline(self._target_device), 4
                ),
                "ampere_dynamic_hold_sec": round(
                    self.compute_ampere_hold_required(
                        self._target_device, adapt_snap.tremor_coefficient
                    ),
                    4,
                ),
                "confirm_hold_required_sec": round(self._required_confirm_hold(), 4),
                "health_level": self._health_level.value,
                "active_min_detection_confidence": adapt_snap.active_min_detection_confidence,
                "tremor_coefficient": adapt_snap.tremor_coefficient,
            },
            "aruco_anchor": {
                "marker_id": anchor_spec["marker_id"],
                "device_id": anchor_spec["device_id"],
                "label": anchor_spec["label"],
                "bbox": list(anchor_spec["bbox"]),
                "aligned": self._last_reason_code != ReasonCode.OUTSIDE_ZONE,
            },
            "adaptation": adapt_snap.to_dict(),
            "face_intent": face_snap.to_dict(),
            "circuit_breaker_alert": self._circuit_breaker_alert,
            "target_device": self._target_device,
            "target_command": self._target_command,
            "risk_tier": self._target_risk_tier,
            "available_next_actions": next_actions_map.get(self._state, []),
            "last_reason_code": self._last_reason_code.value,
            "recovery_message": get_recovery_message(self._last_reason_code),
            "simulated": True,
        }
