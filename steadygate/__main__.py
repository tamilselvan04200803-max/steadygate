"""SteadyGate 2.0 unified CLI entrypoint (`python -m steadygate`)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from steadygate.actuator import VirtualActuator
from steadygate.config import is_feature_enabled, load_config
from steadygate.events import Observation
from steadygate.policy import SteadyGatePolicy
from steadygate.vision import (
    PRIVACY_CONSENT_NOTICE,
    LandmarkRecordLogger,
    classify_landmarks,
    generate_anatomical_landmarks,
)


def build_synthetic_demo_sequence() -> list[tuple[float, Observation]]:
    """Build a deterministic synthetic sequence exercising arm -> request -> hold -> release -> confirm -> commit."""
    steps: list[tuple[float, str]] = [
        (0.0, "OPEN_PALM"),       # Arm
        (0.2, "POINTING_UP"),     # Request lamp:SET_ON (hold starts at 0.2s)
        (0.5, "POINTING_UP"),     # Hold (0.3s)
        (0.8, "POINTING_UP"),     # Hold (0.6s)
        (1.05, "POINTING_UP"),    # Hold completes (0.85s >= 0.80s) -> AWAITING_RELEASE
        (1.25, "OPEN_PALM"),      # Release -> AWAITING_CONFIRM
        (1.45, "THUMBS_UP"),      # Start confirm hold (at 1.45s)
        (1.70, "THUMBS_UP"),      # Confirm holding (0.25s)
        (2.00, "THUMBS_UP"),      # Confirm completes (0.55s >= 0.50s) -> COMMIT lamp:SET_ON
    ]
    out: list[tuple[float, Observation]] = []
    for t_mono, gesture in steps:
        lms = generate_anatomical_landmarks(gesture)
        g_label, score, quality, in_zone, wrist_xy = classify_landmarks(lms)
        out.append(
            (
                t_mono,
                Observation(
                    gesture=g_label,
                    score=score,
                    hand_present=True,
                    landmark_quality=quality,
                    in_zone=in_zone,
                    num_hands=1,
                    wrist_xy=wrist_xy,
                    landmarks=lms,
                ),
            )
        )
    return out


def main(argv: list[str] | None = None) -> int:
    raw_args = list(sys.argv[1:] if argv is None else argv)
    if raw_args and raw_args[0] == "chaos":
        from steadygate.chaos import main as chaos_main

        return chaos_main(raw_args[1:])

    parser = argparse.ArgumentParser(
        prog="steadygate",
        description="SteadyGate 2.0 Deterministic Gesture Control & Telemetry Engine",
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to config.yaml")
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="Run a deterministic synthetic command sequence without hardware webcam",
    )
    parser.add_argument(
        "--webcam",
        action="store_true",
        help="Attempt live hardware webcam capture",
    )
    parser.add_argument(
        "--record",
        type=Path,
        default=None,
        help="Record privacy-safe landmark/gesture JSONL stream (no raw video)",
    )
    parser.add_argument(
        "--consent",
        action="store_true",
        help="Acknowledge the privacy consent notice when using --record",
    )
    parser.add_argument(
        "--log-out",
        type=Path,
        default=None,
        help="Optional path for FlightRecorder JSONL output",
    )
    args = parser.parse_args(raw_args)

    cfg = load_config(args.config)

    if args.webcam and not args.synthetic:
        print("LOCAL RUNTIME EXCLUSION: Hardware interface mocked.")
        return 0

    record_logger: LandmarkRecordLogger | None = None
    if args.record is not None:
        print(PRIVACY_CONSENT_NOTICE)
        if is_feature_enabled(cfg, "privacy_record_consent") and not args.consent:
            print("ERROR: --record requires --consent flag to confirm privacy notice.", file=sys.stderr)
            return 2
        record_logger = LandmarkRecordLogger(args.record, consent_acknowledged=True)

    actuator = VirtualActuator(cfg)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    recorder = None
    if is_feature_enabled(cfg, "flight_recorder"):
        try:
            from steadygate.recorder import FlightRecorder

            recorder = FlightRecorder(cfg, session_path=args.log_out)
        except ImportError:
            recorder = None

    seq = build_synthetic_demo_sequence()
    for frame_id, (t_mono, obs) in enumerate(seq):
        if record_logger is not None:
            record_logger.write_observation(t_mono, frame_id, obs)
        ev = policy.step(t_mono, frame_id, obs)
        if recorder is not None:
            recorder.record(ev)
        print(ev.to_jsonl(include_ml_payload=True))

    if recorder is not None:
        recorder.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
