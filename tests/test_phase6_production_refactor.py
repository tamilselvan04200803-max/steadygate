"""Phase 6 Production Refactor Tests (`tests/test_phase6_production_refactor.py`).

Verifies the SteadyGate 2.0 Production Engine systems:
1. Intent Locking & False-Positive Trigger Suppression:
   - Mitigation Gate 1: OpenCV ArUco Spatial Anchor Locking (`ArucoSpatialAnchorTracker`,
     `DICT_4X4_50`), mapping duplicate appliances (`lamp` -> ID 10, `lamp_2` -> ID 11)
     and rejecting gestures with `OUTSIDE_ZONE` when the hand bounding box / pointing ray
     does not intersect the targeted ArUco marker spatial anchor.
   - Mitigation Gate 2: Face/Gaze Intent Match (`USER_DISTRACTED` when `abs(head_yaw_deg) > 20`
     or gaze outside interaction zone).
2. Ampere-Load Dynamic Hand Gesture Timing Matrix:
   - Low Ampere Devices (`lamp`, `lamp_2`, `curtain`): `0.35s` hold baseline.
   - High Ampere Devices (`fan`: `1.20s`, `heater`: `1.80s`).
   - Adaptive formula: `hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)`.
3. Continuous ML Training Pipeline & Storage Layer (`ml_training_payload` in JSONL with
   privacy-safe raw pixel masking/stripping).
4. Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK` with decision `CANCEL` when target
   appliance is `DEFECTIVE` or has an unacknowledged fault, plus Feedforward Coach alert:
   `"Action blocked: Target appliance reporting component degradation."`).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from steadygate.adaptation import (
    EnvironmentalAdaptationEngine,
    compute_background_entropy,
    isolate_hand_from_background,
)
from steadygate.actuator import ActionCommand, VirtualActuator
from steadygate.aruco_anchor import ArucoSpatialAnchorTracker
from steadygate.coach import FeedforwardCoach
from steadygate.config import load_config
from steadygate.events import Observation, sanitize_frame_for_ml_storage
from steadygate.face_intent import FaceIntentTracker
from steadygate.policy import SteadyGatePolicy
from steadygate.recorder import FlightRecorder, load_session_events
from steadygate.recovery import CIRCUIT_BREAKER_ALERT_MESSAGE
from steadygate.vision import generate_anatomical_landmarks


def test_aruco_spatial_anchor_locking_and_duplicate_appliances() -> None:
    """Upgrade 1 (Mitigation Gate 1): Verify cv2.aruco marker generation/detection,
    duplicate appliance disambiguation (`lamp` [ID 10] vs `lamp_2` [ID 11]), and
    spatial anchor lock enforcement (`OUTSIDE_ZONE` when hand bbox does not intersect).
    """
    cfg = load_config()
    tracker = ArucoSpatialAnchorTracker(cfg)

    # 1. Generate and detect real OpenCV ArUco markers (ID 10 = lamp, ID 11 = lamp_2)
    blank = np.full((360, 480, 3), 200, dtype=np.uint8)
    stamped = tracker.embed_marker_in_frame(blank, marker_id=10, top_left_xy=(40, 60), size_px=80)
    stamped = tracker.embed_marker_in_frame(stamped, marker_id=11, top_left_xy=(340, 60), size_px=80)
    detections = tracker.detect_markers(stamped)
    detected_ids = {d.marker_id: d.device_id for d in detections}
    assert detected_ids[10] == "lamp"
    assert detected_ids[11] == "lamp_2"

    # 2. Verify duplicate appliance spatial disambiguation (lamp_2 via ArUco Marker ID 11)
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator, use_ampere_load_matrix=True)

    # Hand outside lamp_2 anchor bbox [0.66, 0.15, 0.92, 0.75] -> rejected with OUTSIDE_ZONE
    policy.step(0.0, 0, Observation("OPEN_PALM", 0.93, True, 0.90))
    ev_unlocked = policy.step(
        0.1,
        1,
        Observation(
            gesture="POINTING_UP",
            score=0.93,
            hand_present=True,
            landmark_quality=0.90,
            wrist_xy=(0.20, 0.50),
            aruco_marker_id=11,
            aruco_anchor_locked=False,
        ),
    )
    assert ev_unlocked.decision == "REJECT"
    assert ev_unlocked.reason_code == "OUTSIDE_ZONE"

    # Hand inside lamp_2 anchor bbox (wrist_xy=(0.78, 0.45), ArUco ID 11) -> commits lamp_2:SET_ON with 0.35s hold!
    policy_clean = SteadyGatePolicy(cfg, actuator=actuator, use_ampere_load_matrix=True)
    policy_clean.step(0.2, 2, Observation("OPEN_PALM", 0.94, True, 0.92, wrist_xy=(0.78, 0.45)))
    ev_req = policy_clean.step(
        0.3,
        3,
        Observation(
            "POINTING_UP",
            0.94,
            True,
            0.92,
            wrist_xy=(0.78, 0.45),
            aruco_marker_id=11,
            aruco_anchor_locked=True,
        ),
    )
    assert ev_req.device_id == "lamp_2"
    assert ev_req.hold_required == pytest.approx(0.35, 1e-4)


def test_ampere_load_dynamic_timing_matrix_and_heater_auto_expire() -> None:
    """Upgrade 2: Verify Ampere-Load Dynamic Hand Gesture Timing Matrix (`0.35s` for Low-Ampere
    lamp/lamp_2/curtain, `1.20s` for Fan, `1.80s` for Heater) and `hold_required =
    load_ampere_class_baseline * (1.0 + tremor_coefficient)`, plus Heater auto-expiring ON timer.
    """
    cfg = load_config()
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator, use_ampere_load_matrix=True)

    assert policy.get_load_ampere_class_baseline("lamp") == pytest.approx(0.35, 1e-6)
    assert policy.get_load_ampere_class_baseline("lamp_2") == pytest.approx(0.35, 1e-6)
    assert policy.get_load_ampere_class_baseline("curtain") == pytest.approx(0.35, 1e-6)
    assert policy.get_load_ampere_class_baseline("fan") == pytest.approx(1.20, 1e-6)
    assert policy.get_load_ampere_class_baseline("heater") == pytest.approx(1.80, 1e-6)

    # Verify adaptive formula: hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)
    assert policy.compute_ampere_hold_required("lamp", tremor_coefficient=0.20) == pytest.approx(
        0.35 * 1.20, 1e-6
    )
    assert policy.compute_ampere_hold_required("heater", tremor_coefficient=0.25) == pytest.approx(
        1.80 * 1.25, 1e-6
    )

    # Verify Heater auto-expiring ON timer (auto_expire_sec = 120.0s)
    res = actuator.execute(ActionCommand("heater", "SET_ON", "ON", "HIGH"), t_mono=10.0)
    assert res.ok is True
    assert actuator.devices["heater"].state == "ON"
    actuator.check_auto_expire(t_mono=100.0)
    assert actuator.devices["heater"].state == "ON"
    expired = actuator.check_auto_expire(t_mono=131.0)
    assert "heater" in expired
    assert actuator.devices["heater"].state == "OFF"


def test_ml_training_payload_and_privacy_safeguard_in_session_jsonl(
    tmp_path: Path,
) -> None:
    """Upgrade 3: Verify ml_training_payload is appended to every step's DecisionEvent in JSONL
    and raw video array pixels are strictly masked/stripped.
    """
    cfg = load_config()
    session_file = tmp_path / "session_ml_training.jsonl"
    policy = SteadyGatePolicy(cfg, actuator=VirtualActuator(cfg))

    raw_rgb = np.full((120, 160, 3), 210, dtype=np.uint8)
    privacy_meta = sanitize_frame_for_ml_storage(raw_rgb)
    assert privacy_meta["raw_video_pixels_masked"] is True
    assert privacy_meta["pixel_array_stored"] is False
    assert privacy_meta["sanitized_frame_shape"] == [0, 0, 0]
    assert privacy_meta["masked_pixel_sum"] == 0

    lms = generate_anatomical_landmarks("OPEN_PALM")
    obs = Observation(
        gesture="OPEN_PALM",
        score=0.93,
        hand_present=True,
        landmark_quality=0.92,
        landmarks=lms,
        user_id="user_alpha_01",
        brightness=0.68,
        contrast=0.24,
        background_entropy=0.42,
        tremor_coefficient=0.05,
        aruco_marker_id=10,
    )

    with FlightRecorder(cfg, session_path=session_file) as rec:
        ev = policy.step(0.0, 0, obs)
        rec.record(ev)

    raw_lines = session_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(raw_lines) == 1
    parsed = json.loads(raw_lines[0])
    assert "ml_training_payload" in parsed

    ml = parsed["ml_training_payload"]
    assert ml["raw_tracking_data"]["frame_id"] == 0
    assert ml["raw_tracking_data"]["timestamp_mono"] == 0.0
    assert ml["raw_tracking_data"]["detection_confidence"] == pytest.approx(0.93, 1e-4)
    assert ml["raw_tracking_data"]["aruco_marker_id"] == 10
    assert len(ml["raw_tracking_data"]["landmarks"]) == 21
    assert ml["user_environment_profile"]["user_id"] == "user_alpha_01"
    assert ml["user_environment_profile"]["environment_metrics"]["lux"] == pytest.approx(0.68, 1e-4)
    assert ml["user_environment_profile"]["environment_metrics"]["contrast"] == pytest.approx(0.24, 1e-4)
    assert ml["privacy_safeguard"]["raw_video_pixels_masked"] is True
    assert ml["privacy_safeguard"]["pixel_array_stored"] is False

    loaded = load_session_events(session_file)
    assert len(loaded) == 1
    assert loaded[0].ml_training_payload is not None


def test_90_frame_environmental_adaptation_and_tremor_hold_formula() -> None:
    """Verify 90-frame sliding history window, 0.15 low-lux step multiplier,
    background color entropy isolation, EMA smoothing, and hold_baseline * (1 + tremor_coefficient).
    """
    cfg = load_config()
    engine = EnvironmentalAdaptationEngine(cfg)
    assert engine.window_size == 90

    for i in range(95):
        snap = engine.update(
            brightness=0.18,
            wrist_xy=(0.50 + (0.015 if i % 2 == 0 else -0.015), 0.50),
        )
    assert snap.window_fill == 90
    assert snap.low_or_variable_lighting is True
    expected_conf = round(engine.base_confidence * (1.0 + 0.15), 6)
    assert snap.active_min_detection_confidence == pytest.approx(expected_conf, 1e-5)

    hold_base = 0.80
    tremor_c = 0.25
    scaled_hold = engine.compute_hold_required(hold_base, tremor_coefficient=tremor_c)
    assert scaled_hold == pytest.approx(0.80 * (1.0 + 0.25), 1e-6)

    noisy_bg = np.random.default_rng(1).integers(0, 256, size=(64, 64, 3), dtype=np.uint8)
    ent = compute_background_entropy(noisy_bg)
    assert 0.5 <= ent <= 1.0
    lms = generate_anatomical_landmarks("POINTING_UP")
    isolated, gain = isolate_hand_from_background(lms, background_color_field=noisy_bg)
    assert len(isolated) == 21
    assert 0.0 < gain < 1.0

    assert engine.classify_score_boundary(0.80, min_score=0.70) == "PASS"
    assert engine.classify_score_boundary(0.56, min_score=0.70) == "AMBIGUOUS_STATE"
    assert engine.classify_score_boundary(0.40, min_score=0.70) == "REJECT"


def test_ambiguous_state_and_face_intent_verification_user_distracted() -> None:
    """Upgrade 1 (Mitigation Gate 2): Verify 75% boundary enters AMBIGUOUS_STATE when face intent is
    verified, and rejects with USER_DISTRACTED when looking away (> +/-20 deg) or gaze outside zone.
    """
    cfg = load_config()
    policy = SteadyGatePolicy(cfg)
    face_tracker = FaceIntentTracker(cfg)

    policy.step(0.0, 0, Observation("OPEN_PALM", 0.92, True, 0.90))

    ev_amb = policy.step(
        0.1,
        1,
        Observation(
            gesture="POINTING_UP",
            score=0.56,
            hand_present=True,
            landmark_quality=0.85,
            face_detected=True,
            head_yaw_deg=5.0,
            head_pitch_deg=-4.0,
            gaze_xy=(0.50, 0.50),
            gaze_in_zone=True,
        ),
    )
    assert ev_amb.state_after == "AMBIGUOUS_STATE"
    assert ev_amb.decision == "HOLD"

    distracted_obs = Observation(
        gesture="POINTING_UP",
        score=0.91,
        hand_present=True,
        landmark_quality=0.90,
        face_detected=True,
        head_yaw_deg=28.0,
        head_pitch_deg=3.0,
        gaze_xy=(0.02, 0.02),
        gaze_in_zone=False,
    )
    face_res = face_tracker.verify_observation(distracted_obs)
    assert face_res.user_intent_verified is False
    assert face_res.classification == "UNINTENTIONAL"
    assert face_res.reason_code == "USER_DISTRACTED"

    ev_dist = policy.step(0.3, 2, distracted_obs)
    assert ev_dist.decision == "REJECT"
    assert ev_dist.reason_code == "USER_DISTRACTED"
    assert ev_dist.state_after == "IDLE"


def test_actuator_health_circuit_breaker_device_fault_lock_and_coach_alert() -> None:
    """Upgrade 4: Verify that a DEFECTIVE target appliance triggers the Circuit Breaker prior to SET,
    cancels with DEVICE_FAULT_LOCK, withholds the physical packet, and alerts FeedforwardCoach.
    """
    cfg = load_config()
    actuator = VirtualActuator(cfg)
    actuator.set_device_defective("lamp", defective=True, unacknowledged_fault=True)

    policy = SteadyGatePolicy(cfg, actuator=actuator)
    coach = FeedforwardCoach(cfg)

    policy.step(0.0, 0, Observation("OPEN_PALM", 0.93, True, 0.90))
    policy.step(0.1, 1, Observation("POINTING_UP", 0.93, True, 0.90))
    policy.step(0.5, 2, Observation("POINTING_UP", 0.93, True, 0.90))
    policy.step(0.95, 3, Observation("POINTING_UP", 0.93, True, 0.90))  # -> AWAITING_RELEASE
    policy.step(1.10, 4, Observation("OPEN_PALM", 0.93, True, 0.90))    # -> AWAITING_CONFIRM
    policy.step(1.25, 5, Observation("THUMBS_UP", 0.93, True, 0.90))    # Start confirm hold
    policy.step(1.55, 6, Observation("THUMBS_UP", 0.93, True, 0.90))    # Confirm holding
    ev_cb = policy.step(1.80, 7, Observation("THUMBS_UP", 0.93, True, 0.90))  # Attempt commit

    assert ev_cb.decision == "CANCEL"
    assert ev_cb.reason_code == "DEVICE_FAULT_LOCK"
    assert ev_cb.action_command is None
    assert actuator.devices["lamp"].state == "OFF"
    assert policy.circuit_breaker_alert == CIRCUIT_BREAKER_ALERT_MESSAGE
    assert (
        policy.describe()["recovery_message"]
        == "Action blocked: Target appliance reporting component degradation."
    )

    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    rendered = coach.render(frame, policy)
    assert rendered.shape == (480, 640, 3)
    assert (
        coach.last_alert_banner
        == "Action blocked: Target appliance reporting component degradation."
    )
