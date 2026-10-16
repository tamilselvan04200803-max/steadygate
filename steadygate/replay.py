"""CLI & Engine for Deterministic Flight Log Replay (`python -m steadygate.replay`).

Re-executes SteadyGatePolicy deterministically over a logged JSONL session (supporting
both positional `<log>` and `--log <log>`) and verifies that every single step
reproduces the exact state, decision, and reason_code.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any

from steadygate.actuator import VirtualActuator
from steadygate.config import load_config
from steadygate.events import DecisionEvent, Observation, ReasonCode
from steadygate.policy import SteadyGatePolicy
from steadygate.recorder import latest_session_path, load_session_events


@dataclass
class ReplayReport:
    """Summary of deterministic replay verification."""

    log_path: str
    total_events: int
    matched_events: int
    mismatches: list[dict[str, Any]]
    replayed_events: list[DecisionEvent]

    @property
    def exact_match(self) -> bool:
        return self.total_events == self.matched_events and len(self.mismatches) == 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "log_path": self.log_path,
            "n": self.total_events,
            "total_events": self.total_events,
            "matched_events": self.matched_events,
            "mismatch_count": len(self.mismatches),
            "exact_match": self.exact_match,
            "mismatches": self.mismatches,
        }


def reconstruct_observation_for_replay(logged_event: DecisionEvent) -> Observation:
    """Reconstruct Observation from a logged DecisionEvent."""
    base = logged_event.observation
    in_zone = logged_event.reason_code != ReasonCode.OUTSIDE_ZONE.value
    num_hands = (
        2
        if logged_event.reason_code == ReasonCode.AMBIGUOUS_TARGET.value
        else (1 if base.hand_present else 0)
    )
    return Observation(
        gesture=base.gesture,
        score=base.score,
        hand_present=base.hand_present,
        landmark_quality=base.landmark_quality,
        in_zone=in_zone,
        num_hands=num_hands,
        landmarks=base.landmarks,
        user_id=base.user_id,
        brightness=base.brightness,
        contrast=base.contrast,
        background_entropy=base.background_entropy,
        tremor_coefficient=base.tremor_coefficient,
        head_yaw_deg=base.head_yaw_deg,
        head_pitch_deg=base.head_pitch_deg,
        user_intent_verified=base.user_intent_verified,
        aruco_marker_id=base.aruco_marker_id,
    )


def replay_session(
    log_path: Path | str,
    config: dict[str, Any] | None = None,
) -> ReplayReport:
    """Deterministically replay a JSONL session log through SteadyGatePolicy."""
    cfg = config or load_config()
    logged_events = load_session_events(log_path)
    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    replayed: list[DecisionEvent] = []
    mismatches: list[dict[str, Any]] = []
    matched = 0

    for idx, expected in enumerate(logged_events):
        policy.set_health_level(expected.health_level)

        actuator.clear_faults()
        if expected.reason_code == ReasonCode.ACK_MISSING.value:
            actuator.set_fault(expected.device_id, drop_ack=True)
        elif expected.reason_code == ReasonCode.OUTCOME_UNKNOWN.value:
            actuator.set_fault(expected.device_id, unknown_outcome=True)
        elif expected.reason_code == ReasonCode.DEVICE_FAULT_LOCK.value:
            actuator.set_device_defective(
                expected.device_id, defective=True, unacknowledged_fault=True
            )

        obs = reconstruct_observation_for_replay(expected)
        actual = policy.step(expected.t_mono, expected.frame_id, obs)
        replayed.append(actual)

        exp_dict = expected.to_dict(include_ml_payload=False)
        act_dict = actual.to_dict(include_ml_payload=False)
        if exp_dict == act_dict:
            matched += 1
        else:
            mismatches.append(
                {
                    "index": idx,
                    "frame_id": expected.frame_id,
                    "t_mono": expected.t_mono,
                    "expected": exp_dict,
                    "actual": act_dict,
                }
            )

    return ReplayReport(
        log_path=str(log_path),
        total_events=len(logged_events),
        matched_events=matched,
        mismatches=mismatches,
        replayed_events=replayed,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="steadygate.replay",
        description="Deterministically replay a SteadyGate JSONL session log and verify exact state match",
    )
    parser.add_argument(
        "positional_log",
        nargs="?",
        type=Path,
        default=None,
        help="Optional positional path to logs/session_<timestamp>.jsonl",
    )
    parser.add_argument(
        "--log",
        type=Path,
        default=None,
        help="Path to logs/session_<timestamp>.jsonl (defaults to latest session log)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=None,
        help="Optional path to config.yaml",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output replay verification report as JSON",
    )
    args = parser.parse_args(argv)

    log_path = args.log or args.positional_log or latest_session_path()
    cfg = load_config(args.config)
    report = replay_session(log_path, cfg)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        status = (
            "PASS (100% DETERMINISTIC MATCH)"
            if report.exact_match
            else "FAIL (MISMATCH DETECTED)"
        )
        print(f"=== STEADYGATE DETERMINISTIC REPLAY: {status} ===")
        print(f"Log File       : {report.log_path}")
        print(
            f"Events Verified: {report.matched_events}/{report.total_events} (n={report.total_events})"
        )
        if report.mismatches:
            for m in report.mismatches:
                print(
                    f"  [MISMATCH frame_id={m['frame_id']} t_mono={m['t_mono']}]: "
                    f"expected={m['expected']['state_after']}/{m['expected']['decision']}/{m['expected']['reason_code']} "
                    f"vs actual={m['actual']['state_after']}/{m['actual']['decision']}/{m['actual']['reason_code']}"
                )
    return 0 if report.exact_match else 1


if __name__ == "__main__":
    raise SystemExit(main())
