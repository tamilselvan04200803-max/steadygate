"""Phase 5 Unit & CLI Tests: Production Plugins (`tests/test_phase5_plugins.py`)."""

from __future__ import annotations

import json

import pytest

from steadygate.config import load_config
from steadygate.events import Observation
from steadygate.plugins import (
    GesturePerformanceOptimizer,
    WebhookAdapter,
    build_default_plugin_stack,
    main as plugins_main,
)
from steadygate.policy import SteadyGatePolicy


def test_webhook_adapter_forbids_external_hosts_and_has_zero_side_effects() -> None:
    cfg = load_config()

    # Cloud / external URL must raise ValueError (Hard Rule 4: local 127.0.0.1 only)
    with pytest.raises(ValueError, match="non-local endpoint"):
        WebhookAdapter(endpoint="https://api.example.com/webhook", config=cfg, force_enable=True)

    actuator, webhook, optimizer = build_default_plugin_stack(cfg, enable_webhook_stub=True)
    policy = SteadyGatePolicy(cfg, actuator=actuator)

    steps = [
        (0.0, "OPEN_PALM"),
        (0.2, "POINTING_UP"),
        (0.6, "POINTING_UP"),
        (1.05, "POINTING_UP"),
        (1.25, "OPEN_PALM"),
        (1.45, "THUMBS_UP"),
        (1.75, "THUMBS_UP"),
        (2.00, "THUMBS_UP"),
    ]
    for fid, (t_mono, g) in enumerate(steps):
        ev = policy.step(t_mono, fid, Observation(g, 0.94, True, 0.92))
        optimizer.observe(ev)

    assert len(webhook.outbox) == 1
    delivery = webhook.outbox[0].to_dict()
    assert delivery["dry_run"] is True
    assert delivery["external_network_called"] is False
    assert delivery["feedback_mode"] == "simulated"
    assert delivery["payload"]["action"]["command"] == "SET_ON"
    assert delivery["payload"]["actuator_feedback"]["current_state"] == "ON"


def test_gesture_performance_optimizer_telemetry_and_cli(
    capsys: pytest.CaptureFixture[str],
) -> None:
    cfg = load_config()
    optimizer = GesturePerformanceOptimizer(cfg)
    policy = SteadyGatePolicy(cfg)

    # Feed several low-score POINTING_UP frames to trigger bounded recommendation
    policy.step(0.0, 0, Observation("OPEN_PALM", 0.92, True, 0.90))
    for i in range(1, 6):
        ev = policy.step(i * 0.1, i, Observation("POINTING_UP", 0.55, True, 0.88))
        optimizer.observe(ev)

    summary = optimizer.summarize()
    assert summary["total_events_n"] == 5
    pt_stats = summary["gestures"]["POINTING_UP"]
    assert pt_stats["n"] == 5
    assert pt_stats["rejects_n"] == 5
    recs = {r["gesture"]: r for r in summary["recommendations"]}
    assert recs["POINTING_UP"]["recommended_min_score"] == 0.65

    # Verify CLI execution
    rc = plugins_main(["--json"])
    assert rc == 0
    cli_data = json.loads(capsys.readouterr().out)
    assert cli_data["webhook_stub_outbox_n"] == 1
    assert cli_data["gesture_optimization_telemetry"]["total_events_n"] >= 8
