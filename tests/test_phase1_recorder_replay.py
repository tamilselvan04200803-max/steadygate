"""Phase 1 Unit & CLI Tests: FlightRecorder, steadygate.explain, and steadygate.replay."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from steadygate.actuator import VirtualActuator
from steadygate.config import load_config
from steadygate.events import Observation
from steadygate.explain import explain_event, main as explain_main, select_event_at
from steadygate.policy import SteadyGatePolicy
from steadygate.recorder import FlightRecorder, load_session_events
from steadygate.replay import main as replay_main, replay_session


def _obs(
    gesture: str,
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


def test_flight_recorder_streams_valid_jsonl(tmp_path: Path) -> None:
    cfg = load_config()
    session_file = tmp_path / "session_test_001.jsonl"
    policy = SteadyGatePolicy(cfg, actuator=VirtualActuator(cfg))

    with FlightRecorder(cfg, session_path=session_file) as rec:
        rec.record(policy.step(0.0, 0, _obs("OPEN_PALM")))
        rec.record(policy.step(0.2, 1, _obs("POINTING_UP")))
        rec.record(policy.step(0.6, 2, _obs("POINTING_UP")))

    assert session_file.exists()
    events = load_session_events(session_file)
    assert len(events) == 3
    assert events[0].state_after == "ARMED"
    assert events[1].state_after == "REQUESTING"
    assert events[2].state_after == "HOLDING"


def test_explain_cli_and_counterfactuals(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cfg = load_config()
    session_file = tmp_path / "session_explain.jsonl"
    policy = SteadyGatePolicy(cfg, actuator=VirtualActuator(cfg))

    with FlightRecorder(cfg, session_path=session_file) as rec:
        rec.record(policy.step(0.0, 0, _obs("OPEN_PALM")))
        rec.record(policy.step(0.2, 1, _obs("POINTING_UP")))
        rec.record(policy.step(0.5, 2, _obs("POINTING_UP")))
        rec.record(policy.step(0.8, 3, _obs("POINTING_UP", score=0.40)))  # LOW_SCORE reject

    # CLI test at --at 0.55 (matches frame_id=2 at t_mono=0.5s in HOLDING)
    rc = explain_main(["--log", str(session_file), "--at", "0.55", "--json"])
    assert rc == 0
    out_hold = json.loads(capsys.readouterr().out)
    assert out_hold["frame_id"] == 2
    assert out_hold["state_after"] == "HOLDING"
    assert out_hold["reason_code"] == "HOLD_TOO_SHORT"
    assert out_hold["hold_remaining_sec"] == pytest.approx(0.5, 1e-4)
    assert any("additional 0.500s" in cf for cf in out_hold["counterfactuals"])

    # CLI test at --at 0.85 (matches frame_id=3 at t_mono=0.8s with LOW_SCORE)
    rc2 = explain_main(["--log", str(session_file), "--at", "0.85"])
    assert rc2 == 0
    text_out = capsys.readouterr().out
    assert "LOW_SCORE" in text_out
    assert "Counterfactual Status:" in text_out


def test_deterministic_replay_exact_match_and_tamper_detection(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cfg = load_config()
    session_file = tmp_path / "session_replay.jsonl"
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    trace = [
        (0.0, _obs("UNKNOWN", hand_present=False)),
        (0.1, _obs("OPEN_PALM", in_zone=False)),
        (0.2, _obs("OPEN_PALM")),
        (0.4, _obs("POINTING_UP")),
        (0.7, _obs("POINTING_UP")),
        (1.0, _obs("POINTING_UP")),
        (1.25, _obs("POINTING_UP")),  # reaches 0.85s >= 0.80s -> AWAITING_RELEASE
        (1.45, _obs("OPEN_PALM")),    # release -> AWAITING_CONFIRM
        (1.65, _obs("THUMBS_UP")),    # confirm hold start
        (1.95, _obs("THUMBS_UP")),    # confirm hold 0.30s
        (2.20, _obs("THUMBS_UP")),    # confirm hold 0.55s >= 0.50s -> COMMIT
        (2.40, _obs("OPEN_PALM")),    # re-arm
        (2.60, _obs("CLOSED_FIST")),  # user cancel -> IDLE
    ]

    with FlightRecorder(cfg, session_path=session_file) as rec:
        for fid, (t_mono, obs) in enumerate(trace):
            rec.record(policy.step(t_mono, fid, obs))

    report = replay_session(session_file, cfg)
    assert report.exact_match is True
    assert report.total_events == len(trace)
    assert report.matched_events == len(trace)

    # Verify CLI invocation returns 0
    rc = replay_main(["--log", str(session_file), "--json"])
    assert rc == 0
    cli_report = json.loads(capsys.readouterr().out)
    assert cli_report["exact_match"] is True
    assert cli_report["n"] == len(trace)

    # Tamper with one line in a copy and verify replay catches mismatch (exit code 1)
    tampered_file = tmp_path / "session_tampered.jsonl"
    lines = session_file.read_text(encoding="utf-8").splitlines()
    bad_obj = json.loads(lines[4])
    bad_obj["state_after"] = "IDLE"
    lines[4] = json.dumps(bad_obj)
    tampered_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    rc_bad = replay_main(["--log", str(tampered_file)])
    assert rc_bad == 1
    bad_text = capsys.readouterr().out
    assert "FAIL (MISMATCH DETECTED)" in bad_text
