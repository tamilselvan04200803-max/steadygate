"""Production Plugins, Gesture Fit Report & Modular Output Adapters (`steadygate/plugins.py`).

Phase 5 Deliverables:
  - Gesture Fit Report & performance optimization telemetry (`GesturePerformanceOptimizer`,
    computing per-gesture success, confusions, and background-trigger count from recorded trials)
  - Modular output adapters: `VirtualActuator` defaults and `WebhookAdapter` stubs
    without external side-effects (strictly local 127.0.0.1 / offline dry-run).
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
import json
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from steadygate.actuator import ActuatorFeedback, VirtualActuator
from steadygate.config import is_feature_enabled, load_config
from steadygate.events import ActionCommand, DecisionEvent, Observation, ReasonCode
from steadygate.policy import SteadyGatePolicy
from steadygate.recorder import latest_session_path, load_session_events

ALLOWED_LOCAL_HOSTS = {"127.0.0.1", "localhost"}


@dataclass
class WebhookDeliveryStub:
    """Captured webhook payload from WebhookAdapter without external network side-effects."""

    endpoint: str
    event_type: str
    payload: dict[str, Any]
    dry_run: bool = True
    external_network_called: bool = False
    feedback_mode: str = "simulated"

    def to_dict(self) -> dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "event_type": self.event_type,
            "payload": self.payload,
            "dry_run": self.dry_run,
            "external_network_called": self.external_network_called,
            "feedback_mode": "simulated",
        }


class WebhookAdapter:
    """Offline-safe WebhookAdapter stub with zero external side-effects.

    Hard Rule 4: Enforces local-only host validation (127.0.0.1 / localhost) and
    stores serialized webhook envelopes in an in-memory outbox without performing
    outbound network calls.
    """

    def __init__(
        self,
        endpoint: str = "http://127.0.0.1:8765/api/webhook-stub",
        config: dict[str, Any] | None = None,
        *,
        force_enable: bool = False,
    ) -> None:
        self.config = config or load_config()
        self.enabled = force_enable or is_feature_enabled(self.config, "webhook_adapter")
        self._validate_local_endpoint(endpoint)
        self.endpoint = endpoint
        self.outbox: list[WebhookDeliveryStub] = []

    @staticmethod
    def _validate_local_endpoint(url: str) -> None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if host not in ALLOWED_LOCAL_HOSTS:
            raise ValueError(
                f"WebhookAdapter forbids non-local endpoint '{url}'. "
                f"Only {sorted(ALLOWED_LOCAL_HOSTS)} are permitted."
            )

    def emit(self, action: ActionCommand, feedback: ActuatorFeedback) -> WebhookDeliveryStub | None:
        """Record a simulated webhook delivery stub without external side-effects."""
        if not self.enabled:
            return None

        envelope = {
            "schema_version": "2.0.0",
            "feedback_mode": "simulated",
            "simulated": True,
            "action": action.to_dict(),
            "actuator_feedback": feedback.to_dict(),
        }
        stub = WebhookDeliveryStub(
            endpoint=self.endpoint,
            event_type="steadygate.command.committed",
            payload=envelope,
            dry_run=True,
            external_network_called=False,
        )
        self.outbox.append(stub)
        return stub


@dataclass
class GestureTelemetryStats:
    """Aggregated telemetry statistics for a single gesture label."""

    gesture: str
    frames_n: int = 0
    score_sum: float = 0.0
    quality_sum: float = 0.0
    commits_n: int = 0
    rejects_n: int = 0
    confusions_n: int = 0
    background_triggers_n: int = 0
    reason_counts: Counter[str] = field(default_factory=Counter)

    def to_dict(self) -> dict[str, Any]:
        mean_score = (self.score_sum / self.frames_n) if self.frames_n > 0 else 0.0
        mean_quality = (self.quality_sum / self.frames_n) if self.frames_n > 0 else 0.0
        success_rate = (
            ((self.frames_n - self.rejects_n) / self.frames_n)
            if self.frames_n > 0
            else 0.0
        )
        return {
            "gesture": self.gesture,
            "n": self.frames_n,
            "mean_score": round(mean_score, 4),
            "mean_landmark_quality": round(mean_quality, 4),
            "success_rate": round(success_rate, 4),
            "commits_n": self.commits_n,
            "rejects_n": self.rejects_n,
            "confusions_n": self.confusions_n,
            "background_triggers_n": self.background_triggers_n,
            "reason_counts": dict(self.reason_counts),
        }


class GesturePerformanceOptimizer:
    """Analyzes DecisionEvent telemetry streams to generate Gesture Fit Reports and optimization metrics."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        self.stats_by_gesture: dict[str, GestureTelemetryStats] = {}
        self.total_events_n: int = 0

    def observe(self, event: DecisionEvent) -> None:
        """Ingest a single DecisionEvent into the telemetry optimizer."""
        self.total_events_n += 1
        g = event.observation.gesture
        if g not in self.stats_by_gesture:
            self.stats_by_gesture[g] = GestureTelemetryStats(gesture=g)
        st = self.stats_by_gesture[g]
        st.frames_n += 1
        st.score_sum += event.observation.score
        st.quality_sum += event.observation.landmark_quality
        st.reason_counts[event.reason_code] += 1
        if event.reason_code == ReasonCode.TARGET_CHANGED.value:
            st.confusions_n += 1
        if event.reason_code in (
            ReasonCode.OUTSIDE_ZONE.value,
            ReasonCode.USER_DISTRACTED.value,
        ):
            st.background_triggers_n += 1
        if event.decision == "COMMIT":
            st.commits_n += 1
        elif event.decision == "REJECT":
            st.rejects_n += 1

    def observe_all(self, events: list[DecisionEvent]) -> None:
        for ev in events:
            self.observe(ev)

    def summarize(self) -> dict[str, Any]:
        """Return empirical per-gesture Gesture Fit Report and bounded threshold recommendations."""
        base_min_score = float(self.config.get("policy", {}).get("min_score", 0.70))
        recommendations: list[dict[str, Any]] = []

        for g, st in sorted(self.stats_by_gesture.items()):
            info = st.to_dict()
            low_score_n = st.reason_counts.get(ReasonCode.LOW_SCORE.value, 0)
            short_hold_n = st.reason_counts.get(ReasonCode.HOLD_TOO_SHORT.value, 0)

            rec_min_score = base_min_score
            note = "Threshold nominal."
            if st.frames_n >= 3 and (low_score_n / st.frames_n) > 0.30:
                rec_min_score = round(max(0.60, base_min_score - 0.05), 2)
                note = (
                    f"Observed {low_score_n}/{st.frames_n} (n={st.frames_n}) LOW_SCORE frames; "
                    f"bounded -0.05 threshold adjustment candidate."
                )
            elif st.frames_n >= 3 and info["mean_score"] >= 0.90 and low_score_n == 0:
                note = (
                    f"High mean score ({info['mean_score']:.3f} over n={st.frames_n}); "
                    f"hold frames={short_hold_n}."
                )

            recommendations.append(
                {
                    "gesture": g,
                    "n": st.frames_n,
                    "current_min_score": base_min_score,
                    "recommended_min_score": rec_min_score,
                    "note": note,
                }
            )

        return {
            "total_events_n": self.total_events_n,
            "feedback_mode": "simulated",
            "gestures": {g: st.to_dict() for g, st in sorted(self.stats_by_gesture.items())},
            "recommendations": recommendations,
        }


GestureFitReport = GesturePerformanceOptimizer


def build_default_plugin_stack(
    config: dict[str, Any] | None = None,
    *,
    enable_webhook_stub: bool = True,
) -> tuple[VirtualActuator, WebhookAdapter, GesturePerformanceOptimizer]:
    """Construct VirtualActuator with attached WebhookAdapter stub and GesturePerformanceOptimizer."""
    cfg = config or load_config()
    actuator = VirtualActuator(cfg)
    webhook = WebhookAdapter(config=cfg, force_enable=enable_webhook_stub)
    actuator.register_adapter(webhook)
    optimizer = GesturePerformanceOptimizer(cfg)
    return actuator, webhook, optimizer


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="steadygate.plugins",
        description="Run SteadyGate 2.0 Gesture Fit Report & WebhookAdapter Stub verification",
    )
    parser.add_argument("--log", type=Path, default=None, help="Optional session JSONL log to analyze")
    parser.add_argument("--config", type=Path, default=None, help="Optional path to config.yaml")
    parser.add_argument("--json", action="store_true", help="Emit JSON output")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    actuator, webhook, optimizer = build_default_plugin_stack(cfg, enable_webhook_stub=True)

    if args.log is not None:
        events = load_session_events(args.log)
        optimizer.observe_all(events)
    else:
        try:
            latest = latest_session_path()
            events = load_session_events(latest)
            optimizer.observe_all(events)
        except FileNotFoundError:
            pass

    # Execute one deterministic commit through policy -> VirtualActuator -> WebhookAdapter stub
    policy = SteadyGatePolicy(cfg, actuator=actuator)
    demo_steps = [
        (0.0, "OPEN_PALM"),
        (0.2, "POINTING_UP"),
        (0.6, "POINTING_UP"),
        (1.05, "POINTING_UP"),
        (1.25, "OPEN_PALM"),
        (1.45, "THUMBS_UP"),
        (1.75, "THUMBS_UP"),
        (2.00, "THUMBS_UP"),
    ]
    for fid, (t_mono, g) in enumerate(demo_steps):
        ev = policy.step(t_mono, fid, Observation(g, 0.94, True, 0.92))
        optimizer.observe(ev)

    report = {
        "virtual_actuator_devices": actuator.snapshot(),
        "webhook_stub_outbox_n": len(webhook.outbox),
        "webhook_stub_deliveries": [d.to_dict() for d in webhook.outbox],
        "gesture_optimization_telemetry": optimizer.summarize(),
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print("=== STEADYGATE 2.0 PRODUCTION PLUGINS & GESTURE FIT REPORT ===")
        print(f"VirtualActuator simulated devices : {len(report['virtual_actuator_devices'])}")
        print(
            f"WebhookAdapter stub deliveries    : n={report['webhook_stub_outbox_n']} "
            "(dry_run=True, external_network_called=False)"
        )
        print(
            f"Gesture telemetry events analyzed : n={report['gesture_optimization_telemetry']['total_events_n']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
