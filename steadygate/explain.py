"""CLI & API for Counterfactual Flight Log Explanation (`python -m steadygate.explain`).

Parses `logs/session_<timestamp>.jsonl` at `--at <seconds>` (supporting both positional
`<log>` and `--log <log>`) and displays the timeline window around that moment,
rejection recovery guidance, and counterfactual conditions computed from logged values.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from steadygate.config import load_config
from steadygate.events import DecisionEvent, ReasonCode
from steadygate.recorder import latest_session_path, load_session_events
from steadygate.recovery import get_recovery_message


def select_event_at(events: list[DecisionEvent], at_seconds: float) -> DecisionEvent:
    """Select the DecisionEvent at or immediately preceding `at_seconds`."""
    if not events:
        raise ValueError("Cannot explain an empty session log.")
    candidates = [ev for ev in events if ev.t_mono <= at_seconds + 1e-9]
    if candidates:
        return candidates[-1]
    return events[0]


def select_timeline_window(
    events: list[DecisionEvent],
    at_seconds: float,
    radius_sec: float = 0.60,
) -> list[dict[str, Any]]:
    """Return compact timeline entries surrounding `at_seconds`."""
    window: list[dict[str, Any]] = []
    for ev in events:
        if abs(ev.t_mono - at_seconds) <= radius_sec:
            window.append(
                {
                    "t_mono": round(ev.t_mono, 4),
                    "frame_id": ev.frame_id,
                    "gesture": ev.observation.gesture,
                    "score": round(ev.observation.score, 3),
                    "state_before": ev.state_before,
                    "state_after": ev.state_after,
                    "decision": ev.decision,
                    "reason_code": ev.reason_code,
                }
            )
    return window


def explain_event(
    event: DecisionEvent,
    config: dict[str, Any] | None = None,
    all_events: list[DecisionEvent] | None = None,
) -> dict[str, Any]:
    """Generate structured counterfactual explanation for a single DecisionEvent."""
    cfg = config or load_config()
    policy_cfg = cfg.get("policy", {})
    min_score = float(policy_cfg.get("min_score", 0.70))
    min_quality = float(policy_cfg.get("min_landmark_quality", 0.50))

    obs = event.observation
    score_delta = round(max(0.0, min_score - obs.score), 4)
    quality_delta = round(max(0.0, min_quality - obs.landmark_quality), 4)
    hold_remaining = round(max(0.0, event.hold_required - event.hold_elapsed), 4)
    hold_pct = (
        round(min(100.0, (event.hold_elapsed / event.hold_required) * 100.0), 2)
        if event.hold_required > 0
        else 0.0
    )

    counterfactuals: list[str] = []
    if not obs.hand_present:
        counterfactuals.append(
            "Counterfactual: If hand_present were True with gesture='OPEN_PALM' and score >= "
            f"{min_score:.2f}, state would transition IDLE -> ARMED."
        )
    if score_delta > 0:
        counterfactuals.append(
            f"Counterfactual: Score is {obs.score:.2f} (< {min_score:.2f}); increasing score by "
            f"+{score_delta:.2f} would pass the confidence gate."
        )
    if quality_delta > 0:
        counterfactuals.append(
            f"Counterfactual: Landmark quality is {obs.landmark_quality:.2f} (< {min_quality:.2f}); "
            f"increasing quality by +{quality_delta:.2f} would pass the landmark gate."
        )
    if event.reason_code == ReasonCode.HOLD_TOO_SHORT.value and hold_remaining > 0:
        counterfactuals.append(
            f"Counterfactual: Sustaining '{obs.gesture}' for an additional {hold_remaining:.3f}s "
            f"(total {event.hold_required:.2f}s) would complete the active hold requirement."
        )
    if event.reason_code == ReasonCode.NOT_RELEASED.value:
        counterfactuals.append(
            "Counterfactual: Showing neutral 'OPEN_PALM' on the next frame transitions "
            "AWAITING_RELEASE -> AWAITING_CONFIRM."
        )
    if event.reason_code == ReasonCode.HEALTH_STRICT.value:
        counterfactuals.append(
            f"Counterfactual: Telemetry health is DEGRADED (2x hold = {event.hold_required:.2f}s). "
            f"If health were GOOD, required hold would be {event.hold_required / 2.0:.2f}s."
        )
    if event.reason_code == ReasonCode.HEALTH_LOCKED.value:
        counterfactuals.append(
            "Counterfactual: Actuation is locked under current health_level="
            f"'{event.health_level}' for risk_tier='{event.risk_tier}'. "
            "Restoring health_level='GOOD' unlocks actuation."
        )
    if event.reason_code == ReasonCode.USER_DISTRACTED.value:
        counterfactuals.append(
            "Counterfactual: Face yaw/pitch exceeded +/-20.0 deg or gaze left the target ArUco zone. "
            "Aligning face orientation within +/-20.0 deg and gazing at the target zone allows hold progression."
        )
    if event.reason_code == ReasonCode.DEVICE_FAULT_LOCK.value:
        counterfactuals.append(
            f"Counterfactual: Target appliance '{event.device_id}' status register is DEFECTIVE. "
            "Clearing and acknowledging the hardware fault unlocks SET actuation."
        )
    if event.decision == "COMMIT":
        counterfactuals.append(
            f"Counterfactual: Hold requirement ({event.hold_required:.2f}s) was satisfied at "
            f"t_mono={event.t_mono:.3f}s; simulated device '{event.device_id}' committed."
        )

    if not counterfactuals:
        counterfactuals.append(
            f"Counterfactual: State '{event.state_after}' active; maintain valid gesture to advance."
        )

    timeline = (
        select_timeline_window(all_events, event.t_mono)
        if all_events is not None
        else []
    )

    return {
        "queried_t_mono": round(event.t_mono, 6),
        "frame_id": event.frame_id,
        "state_before": event.state_before,
        "state_after": event.state_after,
        "decision": event.decision,
        "reason_code": event.reason_code,
        "recovery_message": get_recovery_message(event.reason_code),
        "observation": obs.to_schema_dict(),
        "hold_elapsed": round(event.hold_elapsed, 4),
        "hold_required": round(event.hold_required, 4),
        "hold_progress_pct": hold_pct,
        "hold_remaining_sec": hold_remaining,
        "health_level": event.health_level,
        "device_id": event.device_id,
        "risk_tier": event.risk_tier,
        "timeline_window": timeline,
        "counterfactuals": counterfactuals,
    }


def format_explanation_text(info: dict[str, Any], queried_at: float) -> str:
    """Format counterfactual explanation and timeline window for terminal output."""
    lines = [
        f"=== STEADYGATE FLIGHT RECORDER EXPLAIN (--at {queried_at:.3f}s) ===",
        f"Matched Event : frame_id={info['frame_id']} at t_mono={info['queried_t_mono']:.3f}s",
        f"Transition    : {info['state_before']} -> {info['state_after']} [{info['decision']}]",
        f"Reason Code   : {info['reason_code']}",
        f"Target Device : {info['device_id']} (risk_tier={info['risk_tier']}, simulated)",
        f"Health Level  : {info['health_level']}",
        f"Observation   : gesture={info['observation']['gesture']}, "
        f"score={info['observation']['score']:.3f}, "
        f"hand_present={info['observation']['hand_present']}, "
        f"landmark_quality={info['observation']['landmark_quality']:.3f}",
        f"Hold Progress : {info['hold_elapsed']:.3f}s / {info['hold_required']:.3f}s "
        f"({info['hold_progress_pct']:.1f}%, remaining={info['hold_remaining_sec']:.3f}s)",
        f"Recovery      : {info['recovery_message']}",
    ]
    if info.get("timeline_window"):
        lines.append("Surrounding Timeline:")
        for t_item in info["timeline_window"]:
            lines.append(
                f"  [t={t_item['t_mono']:.3f}s frame={t_item['frame_id']}] "
                f"{t_item['gesture']} ({t_item['score']:.2f}) -> "
                f"{t_item['state_before']}..{t_item['state_after']} [{t_item['decision']}:{t_item['reason_code']}]"
            )
    lines.append("Counterfactual Status:")
    for cf in info["counterfactuals"]:
        lines.append(f"  * {cf}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="steadygate.explain",
        description="Explain SteadyGate JSONL flight log status at --at <seconds>",
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
        "--at",
        type=float,
        required=True,
        help="Monotonic timestamp in seconds to inspect",
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
        help="Emit explanation as JSON",
    )
    args = parser.parse_args(argv)

    log_path = args.log or args.positional_log or latest_session_path()
    cfg = load_config(args.config)
    events = load_session_events(log_path)
    selected = select_event_at(events, args.at)
    explanation = explain_event(selected, cfg, all_events=events)
    explanation["queried_at_arg"] = round(float(args.at), 6)
    explanation["log_path"] = str(log_path)

    if args.json:
        print(json.dumps(explanation, indent=2))
    else:
        print(format_explanation_text(explanation, args.at))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
