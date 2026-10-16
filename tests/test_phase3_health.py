"""Phase 3 Unit Tests: TelemetryHealthEvaluator Hysteresis & Adaptive Strictness."""

from __future__ import annotations

import pytest

from steadygate.actuator import VirtualActuator
from steadygate.config import load_config
from steadygate.events import HealthLevel, Observation, PolicyState
from steadygate.health import TelemetryHealthEvaluator
from steadygate.policy import SteadyGatePolicy


def test_hysteresis_engine_transitions_and_deadband() -> None:
    cfg = load_config()
    evaluator = TelemetryHealthEvaluator(cfg)

    # Start in GOOD
    assert evaluator.level == HealthLevel.GOOD

    # Score in [0.65, 0.75) while GOOD remains GOOD (hysteresis deadband)
    assert evaluator._apply_hysteresis(0.70) == HealthLevel.GOOD

    # Drop below good_to_degraded (0.65) -> DEGRADED
    evaluator.level = evaluator._apply_hysteresis(0.60)
    assert evaluator.level == HealthLevel.DEGRADED

    # Score at 0.70 (inside deadband [0.65, 0.75)) while DEGRADED stays DEGRADED!
    evaluator.level = evaluator._apply_hysteresis(0.70)
    assert evaluator.level == HealthLevel.DEGRADED

    # Score >= degraded_to_good (0.75) recovers to GOOD
    evaluator.level = evaluator._apply_hysteresis(0.78)
    assert evaluator.level == HealthLevel.GOOD

    # Drop below degraded_to_poor (0.38) -> POOR
    evaluator.level = evaluator._apply_hysteresis(0.30)
    assert evaluator.level == HealthLevel.POOR

    # Score at 0.42 (inside deadband [0.38, 0.48)) while POOR stays POOR!
    evaluator.level = evaluator._apply_hysteresis(0.42)
    assert evaluator.level == HealthLevel.POOR

    # Score >= poor_to_degraded (0.48) recovers to DEGRADED
    evaluator.level = evaluator._apply_hysteresis(0.52)
    assert evaluator.level == HealthLevel.DEGRADED


def test_rolling_window_telemetry_degradation_and_recovery() -> None:
    cfg = load_config()
    evaluator = TelemetryHealthEvaluator(cfg)

    # Feed 10 clean frames at 30 FPS (good brightness, minimal wrist jitter, high score)
    snap = None
    for i in range(10):
        obs = Observation(
            gesture="OPEN_PALM",
            score=0.95,
            hand_present=True,
            landmark_quality=0.92,
            wrist_xy=(0.50 + (i % 2) * 0.002, 0.50),
            brightness=0.65,
        )
        snap = evaluator.update(i * 0.033, obs)
    assert snap is not None
    assert snap.health_level == HealthLevel.GOOD

    # Feed 25 dark, high-jitter, low-FPS frames -> drops to POOR
    t = 10 * 0.033
    for i in range(25):
        t += 0.20  # 5 FPS
        obs = Observation(
            gesture="UNKNOWN",
            score=0.30,
            hand_present=False,
            landmark_quality=0.20,
            wrist_xy=(0.20 if i % 2 == 0 else 0.80, 0.50),
            brightness=0.05,
        )
        snap = evaluator.update(t, obs)
    assert snap is not None
    assert snap.health_level == HealthLevel.POOR


def test_degraded_doubles_hold_and_enforces_confirmation() -> None:
    cfg = load_config()
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)
    policy.set_health_level(HealthLevel.DEGRADED)

    # Normal LOW risk hold is 0.80s; in DEGRADED mode it must double to 1.60s,
    # and confirm_hold_required doubles from 0.50s to 1.00s.
    ev0 = policy.step(0.0, 0, Observation("OPEN_PALM", 0.94, True, 0.92))
    assert ev0.state_after == "ARMED"
    assert ev0.reason_code == "HEALTH_STRICT"
    assert ev0.hold_required == pytest.approx(1.60, 1e-4)

    ev1 = policy.step(0.2, 1, Observation("POINTING_UP", 0.95, True, 0.92))
    assert ev1.state_after == "REQUESTING"
    assert ev1.hold_required == pytest.approx(1.60, 1e-4)

    # At t=1.1 (elapsed 0.9s >= 0.8s normal, but < 1.6s degraded): still HOLDING!
    policy.step(0.6, 2, Observation("POINTING_UP", 0.95, True, 0.92))
    ev_mid = policy.step(1.1, 3, Observation("POINTING_UP", 0.95, True, 0.92))
    assert ev_mid.state_after == "HOLDING"
    assert ev_mid.decision == "HOLD"
    assert ev_mid.reason_code == "HEALTH_STRICT"

    # Continue holding until elapsed >= 1.60s (at t=1.85, elapsed=1.65s)
    policy.step(1.5, 4, Observation("POINTING_UP", 0.95, True, 0.92))
    ev_rel = policy.step(1.85, 5, Observation("POINTING_UP", 0.95, True, 0.92))
    assert ev_rel.state_after == "AWAITING_RELEASE"

    # Release to neutral OPEN_PALM -> AWAITING_CONFIRM (requires 1.00s confirm hold)
    ev_conf_wait = policy.step(2.05, 6, Observation("OPEN_PALM", 0.94, True, 0.92))
    assert ev_conf_wait.state_after == "AWAITING_CONFIRM"
    assert ev_conf_wait.hold_required == pytest.approx(1.00, 1e-4)

    # Start confirm hold at t=2.20
    policy.step(2.20, 7, Observation("THUMBS_UP", 0.95, True, 0.92))
    policy.step(2.55, 8, Observation("THUMBS_UP", 0.95, True, 0.92))
    # At t=2.80 (elapsed 0.60s >= 0.50s normal, < 1.00s degraded): still AWAITING_CONFIRM
    ev_c_mid = policy.step(2.80, 9, Observation("THUMBS_UP", 0.95, True, 0.92))
    assert ev_c_mid.state_after == "AWAITING_CONFIRM"
    assert ev_c_mid.decision == "HOLD"

    # At t=3.25 (elapsed 1.05s >= 1.00s): COMMIT!
    ev_commit = policy.step(3.25, 10, Observation("THUMBS_UP", 0.95, True, 0.92))
    assert ev_commit.decision == "COMMIT"
    assert actuator.devices["lamp"].state == "ON"


def test_poor_health_locks_all_and_heater_requires_good_exclusively() -> None:
    cfg = load_config()
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    # 1. POOR health activates HEALTH_LOCKED immediately
    policy.set_health_level(HealthLevel.POOR)
    ev_poor = policy.step(0.0, 0, Observation("OPEN_PALM", 0.95, True, 0.92))
    assert ev_poor.decision == "REJECT"
    assert ev_poor.reason_code == "HEALTH_LOCKED"
    assert policy.state == PolicyState.IDLE

    # 2. High-risk Heater (THUMBS_UP in ARMED) requires GOOD health exclusively;
    #    in DEGRADED mode it must reject with HEALTH_LOCKED!
    policy.set_health_level(HealthLevel.DEGRADED)
    ev_arm = policy.step(0.2, 1, Observation("OPEN_PALM", 0.95, True, 0.92))
    assert ev_arm.state_after == "ARMED"

    ev_heater_deg = policy.step(0.4, 2, Observation("THUMBS_UP", 0.95, True, 0.92))
    assert ev_heater_deg.decision == "REJECT"
    assert ev_heater_deg.reason_code == "HEALTH_LOCKED"
    assert ev_heater_deg.state_after == "IDLE"
    assert actuator.devices["heater"].state == "OFF"

    # 3. In GOOD health, Heater (HIGH risk, 1.80s hold) is allowed and commits after full cycle
    policy.set_health_level(HealthLevel.GOOD)
    policy.step(0.6, 3, Observation("OPEN_PALM", 0.95, True, 0.92))
    ev_h_req = policy.step(0.8, 4, Observation("THUMBS_UP", 0.95, True, 0.92))
    assert ev_h_req.state_after == "REQUESTING"
    assert ev_h_req.device_id == "heater"
    assert ev_h_req.risk_tier == "HIGH"
    assert ev_h_req.hold_required == pytest.approx(1.80, 1e-4)
