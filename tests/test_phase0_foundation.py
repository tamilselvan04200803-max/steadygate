"""Phase 0 Foundation Unit Tests (`tests/test_phase0_foundation.py`).

Tests the DecisionEvent schema, 18-member ReasonCode enum, RecoveryEngine,
pure-Python SteadyGatePolicy with fake clock (including t_mono=0.0),
VirtualActuator absolute SET commands & fault injection, and MediaPipe VIDEO tracker.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from steadygate.actuator import VirtualActuator
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
)
from steadygate.policy import SteadyGatePolicy
from steadygate.recovery import RECOVERY_MAP, get_recovery_message
from steadygate.vision import (
    LandmarkRecordLogger,
    MediaPipeVideoTracker,
    classify_landmarks,
    generate_anatomical_landmarks,
)

EXPECTED_REASON_CODES = {
    "NO_HAND",
    "OUTSIDE_ZONE",
    "LOW_SCORE",
    "UNKNOWN_GESTURE",
    "STALE_OBSERVATION",
    "TIMESTAMP_GAP",
    "HOLD_TOO_SHORT",
    "NOT_RELEASED",
    "TARGET_CHANGED",
    "TIMEOUT",
    "USER_CANCEL",
    "HEALTH_STRICT",
    "HEALTH_LOCKED",
    "AMBIGUOUS_TARGET",
    "ACK_MISSING",
    "OUTCOME_UNKNOWN",
    "USER_DISTRACTED",
    "DEVICE_FAULT_LOCK",
}


def make_obs(
    gesture: str = "OPEN_PALM",
    score: float = 0.92,
    hand_present: bool = True,
    landmark_quality: float = 0.90,
    in_zone: bool = True,
    num_hands: int = 1,
) -> Observation:
    return Observation(
        gesture=gesture,
        score=score,
        hand_present=hand_present,
        landmark_quality=landmark_quality,
        in_zone=in_zone,
        num_hands=num_hands,
    )


def test_reason_codes_and_recovery_engine_exact_match() -> None:
    actual_codes = {rc.value for rc in ReasonCode}
    assert actual_codes == EXPECTED_REASON_CODES
    assert set(RECOVERY_MAP.keys()) == set(ReasonCode)
    for code in ReasonCode:
        msg = get_recovery_message(code)
        assert isinstance(msg, str) and len(msg) > 15
        # Zero assumptions regarding user intent
        assert "you wanted" not in msg.lower()
        assert "you meant" not in msg.lower()


def test_decision_event_jsonl_schema_roundtrip() -> None:
    obs = make_obs("POINTING_UP", score=0.88)
    ev = DecisionEvent(
        t_mono=0.0,
        frame_id=0,
        observation=obs,
        state_before="ARMED",
        state_after="REQUESTING",
        decision="ACCEPT",
        reason_code="HOLD_TOO_SHORT",
        hold_elapsed=0.0,
        hold_required=0.8,
        health_level="GOOD",
        device_id="lamp",
        risk_tier="LOW",
    )
    line = ev.to_jsonl()
    parsed = json.loads(line)
    assert set(parsed.keys()) == {
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
    assert set(parsed["observation"].keys()) == {
        "gesture",
        "score",
        "hand_present",
        "landmark_quality",
    }
    restored = DecisionEvent.from_jsonl(line)
    assert restored == ev


def test_policy_full_commit_cycle_with_fake_clock_from_time_zero() -> None:
    cfg = load_config()
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    # Frame 0 at t_mono = 0.0: Arm with OPEN_PALM
    ev0 = policy.step(0.0, 0, make_obs("OPEN_PALM"))
    assert ev0.state_before == "IDLE"
    assert ev0.state_after == "ARMED"
    assert ev0.decision == "ACCEPT"

    # Frame 1 at t_mono = 0.1: Request lamp:SET_ON with POINTING_UP
    ev1 = policy.step(0.1, 1, make_obs("POINTING_UP"))
    assert ev1.state_before == "ARMED"
    assert ev1.state_after == "REQUESTING"
    assert ev1.decision == "ACCEPT"
    assert ev1.device_id == "lamp"
    assert ev1.risk_tier == "LOW"

    # Frame 2 at t_mono = 0.5: Hold in progress (elapsed = 0.4s < 0.8s)
    ev2 = policy.step(0.5, 2, make_obs("POINTING_UP"))
    assert ev2.state_after == "HOLDING"
    assert ev2.decision == "HOLD"
    assert ev2.reason_code == "HOLD_TOO_SHORT"
    assert pytest.approx(ev2.hold_elapsed, 1e-4) == 0.4

    # Frame 3 at t_mono = 0.95: Hold reached (elapsed = 0.85s >= 0.80s) -> AWAITING_RELEASE
    ev3 = policy.step(0.95, 3, make_obs("POINTING_UP"))
    assert ev3.state_after == "AWAITING_RELEASE"
    assert ev3.decision == "ACCEPT"
    assert ev3.reason_code == "NOT_RELEASED"

    # Frame 4 at t_mono = 1.10: User still holding POINTING_UP (has not released yet)
    ev4 = policy.step(1.10, 4, make_obs("POINTING_UP"))
    assert ev4.state_after == "AWAITING_RELEASE"
    assert ev4.decision == "HOLD"
    assert ev4.reason_code == "NOT_RELEASED"

    # Frame 5 at t_mono = 1.25: Release to neutral OPEN_PALM -> AWAITING_CONFIRM
    ev5 = policy.step(1.25, 5, make_obs("OPEN_PALM"))
    assert ev5.state_after == "AWAITING_CONFIRM"
    assert ev5.decision == "ACCEPT"

    # Frame 6 at t_mono = 1.40: Fresh confirm THUMBS_UP begins (elapsed = 0.0s)
    ev6 = policy.step(1.40, 6, make_obs("THUMBS_UP"))
    assert ev6.state_after == "AWAITING_CONFIRM"
    assert ev6.decision == "HOLD"

    # Frame 7 at t_mono = 1.70: Confirm hold in progress (elapsed = 0.30s < 0.50s)
    ev6b = policy.step(1.70, 7, make_obs("THUMBS_UP"))
    assert ev6b.state_after == "AWAITING_CONFIRM"
    assert ev6b.decision == "HOLD"

    # Frame 8 at t_mono = 1.95: Confirm hold reaches 0.55s >= 0.50s -> COMMIT
    ev7 = policy.step(1.95, 8, make_obs("THUMBS_UP"))
    assert ev7.state_before == "AWAITING_CONFIRM"
    assert ev7.state_after == "IDLE"
    assert ev7.decision == "COMMIT"
    assert ev7.action_command is not None
    assert ev7.action_command.command == "SET_ON"
    assert actuator.devices["lamp"].state == "ON"

    # Second cycle: when lamp is ON, POINTING_UP resolves to explicit SET_OFF and turns lamp OFF
    policy.step(2.10, 9, make_obs("OPEN_PALM"))
    ev_off_req = policy.step(2.20, 10, make_obs("POINTING_UP"))
    assert ev_off_req.state_after == "REQUESTING"
    policy.step(2.60, 11, make_obs("POINTING_UP"))
    policy.step(3.05, 12, make_obs("POINTING_UP"))  # -> AWAITING_RELEASE
    policy.step(3.20, 13, make_obs("OPEN_PALM"))    # -> AWAITING_CONFIRM
    policy.step(3.35, 14, make_obs("THUMBS_UP"))
    policy.step(3.65, 15, make_obs("THUMBS_UP"))
    ev_off_commit = policy.step(3.90, 16, make_obs("THUMBS_UP"))
    assert ev_off_commit.decision == "COMMIT"
    assert ev_off_commit.action_command is not None
    assert ev_off_commit.action_command.command == "SET_OFF"
    assert actuator.devices["lamp"].state == "OFF"


def test_policy_guards_and_rejection_reasons() -> None:
    cfg = load_config()
    policy = SteadyGatePolicy(cfg)

    # NO_HAND in IDLE -> REJECT
    ev = policy.step(0.0, 0, make_obs("UNKNOWN", hand_present=False))
    assert ev.decision in ("REJECT", "IGNORE")
    assert ev.reason_code == "NO_HAND"

    # STALE_OBSERVATION when timestamp does not increase
    ev_stale = policy.step(0.0, 1, make_obs("OPEN_PALM"))
    assert ev_stale.decision == "REJECT"
    assert ev_stale.reason_code == "STALE_OBSERVATION"

    # Arm at t=0.1
    policy.step(0.1, 2, make_obs("OPEN_PALM"))
    assert policy.state == PolicyState.ARMED.value

    # TIMESTAMP_GAP when delta > 0.5s
    ev_gap = policy.step(1.0, 3, make_obs("POINTING_UP"))
    assert ev_gap.decision in ("CANCEL", "REJECT")
    assert ev_gap.reason_code == "TIMESTAMP_GAP"
    assert policy.state == PolicyState.IDLE.value

    # OUTSIDE_ZONE
    ev_zone = policy.step(1.1, 4, make_obs("OPEN_PALM", in_zone=False))
    assert ev_zone.decision == "REJECT"
    assert ev_zone.reason_code == "OUTSIDE_ZONE"

    # AMBIGUOUS_TARGET (multiple hands)
    ev_amb = policy.step(1.2, 5, make_obs("OPEN_PALM", num_hands=2))
    assert ev_amb.decision == "REJECT"
    assert ev_amb.reason_code == "AMBIGUOUS_TARGET"

    # LOW_SCORE
    ev_low = policy.step(1.3, 6, make_obs("OPEN_PALM", score=0.45))
    assert ev_low.decision == "REJECT"
    assert ev_low.reason_code == "LOW_SCORE"

    # Arm -> Request -> Early release (HOLD_TOO_SHORT)
    policy.step(1.4, 7, make_obs("OPEN_PALM"))
    policy.step(1.5, 8, make_obs("POINTING_UP"))
    ev_short = policy.step(1.7, 9, make_obs("OPEN_PALM"))
    assert ev_short.decision == "REJECT"
    assert ev_short.reason_code == "HOLD_TOO_SHORT"
    assert policy.state == PolicyState.IDLE.value

    # Arm -> Request -> Target changed mid-hold (TARGET_CHANGED)
    policy.step(1.8, 10, make_obs("OPEN_PALM"))
    policy.step(1.9, 11, make_obs("POINTING_UP"))
    ev_chg = policy.step(2.1, 12, make_obs("VICTORY"))
    assert ev_chg.decision == "REJECT"
    assert ev_chg.reason_code == "TARGET_CHANGED"

    # Arm -> User cancel (USER_CANCEL)
    policy.step(2.2, 13, make_obs("OPEN_PALM"))
    ev_cancel = policy.step(2.3, 14, make_obs("CLOSED_FIST"))
    assert ev_cancel.decision == "CANCEL"
    assert ev_cancel.reason_code == "USER_CANCEL"
    assert policy.state == PolicyState.IDLE.value


def test_policy_describe_reflection_api() -> None:
    policy = SteadyGatePolicy(load_config())
    policy.step(0.0, 0, make_obs("OPEN_PALM"))
    policy.step(0.2, 1, make_obs("VICTORY"))
    policy.step(0.5, 2, make_obs("VICTORY"))
    policy.step(0.8, 3, make_obs("VICTORY"))

    desc = policy.describe()
    assert desc["current_state"] == "HOLDING"
    assert desc["target_device"] == "fan"
    assert desc["target_command"] == "SET_SPEED_2"
    assert desc["risk_tier"] == "MEDIUM"
    assert desc["hold_progress"]["elapsed"] == pytest.approx(0.6, 1e-4)
    assert desc["hold_progress"]["required"] == pytest.approx(1.2, 1e-4)
    assert desc["hold_progress"]["ratio"] == pytest.approx(0.5, 1e-4)
    assert isinstance(desc["available_next_actions"], list) and len(desc["available_next_actions"]) >= 1
    assert isinstance(desc["recovery_message"], str)


def test_virtual_actuator_forbids_toggle_and_injects_faults() -> None:
    actuator = VirtualActuator(load_config())
    with pytest.raises(ValueError, match="SET"):
        ActionCommand(
            device_id="lamp",
            command="TOGGLE_POWER",
            target_state="ON",
            risk_tier="LOW",
        )

    # Fault injection: ACK_MISSING
    actuator.inject_fault("lamp", drop_ack=True)
    fb_ack = actuator.execute(ActionCommand("lamp", "SET_ON", "ON", "LOW"), t_mono=1.0)
    assert not fb_ack.ok
    assert fb_ack.reason_code == ReasonCode.ACK_MISSING.value
    assert fb_ack.to_dict()["label"] == "simulated"

    # Fault injection: OUTCOME_UNKNOWN
    actuator.inject_fault("lamp", drop_ack=False, unknown_outcome=True)
    fb_unk = actuator.execute(ActionCommand("lamp", "SET_ON", "ON", "LOW"), t_mono=2.0)
    assert not fb_unk.ok
    assert fb_unk.reason_code == ReasonCode.OUTCOME_UNKNOWN.value


def test_mediapipe_video_tracker_and_privacy_record_logger(tmp_path: Path) -> None:
    tracker = MediaPipeVideoTracker()
    blank = np.zeros((240, 320, 3), dtype=np.uint8)
    obs0 = tracker.process_frame(blank, t_mono=0.0)
    assert obs0.hand_present is False
    obs1 = tracker.process_frame(blank, t_mono=0.033)
    assert obs1.hand_present is False

    # Non-monotonic timestamp must raise ValueError
    with pytest.raises(ValueError, match="monotonically increasing"):
        tracker.process_frame(blank, t_mono=0.033)
    tracker.close()

    # Landmark classifier on anatomical landmarks
    for expected in ["OPEN_PALM", "CLOSED_FIST", "POINTING_UP", "VICTORY", "THUMBS_UP", "THUMBS_DOWN", "PINCH"]:
        lms = generate_anatomical_landmarks(expected)
        g_out, score, quality, in_zone, _ = classify_landmarks(lms)
        assert g_out == expected
        assert score >= 0.70
        assert quality >= 0.80
        assert in_zone is True

    # Privacy record logger requires explicit consent
    rec_path = tmp_path / "landmarks.jsonl"
    with pytest.raises(PermissionError, match="PRIVACY CONSENT NOTICE"):
        LandmarkRecordLogger(rec_path, consent_acknowledged=False)

    logger = LandmarkRecordLogger(rec_path, consent_acknowledged=True)
    logger.write_observation(0.0, 0, obs0)
    saved = json.loads(rec_path.read_text(encoding="utf-8").strip())
    assert saved["raw_video_stored"] is False
    assert "gesture" in saved and "landmarks" in saved
