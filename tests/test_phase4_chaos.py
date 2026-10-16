"""Phase 4 Unit & CLI Tests: Chaos Lab Stress Engine (`tests/test_phase4_chaos.py`)."""

from __future__ import annotations

import json
from pathlib import Path

from steadygate.chaos import main as chaos_main, run_chaos_matrix


def test_chaos_matrix_deterministic_reproducibility_and_metrics() -> None:
    r1 = run_chaos_matrix(seed=1, runs=50)
    r2 = run_chaos_matrix(seed=1, runs=50)
    assert r1 == r2
    assert r1["runs_n"] == 50

    naive = r1["matrix"]["naive_single_frame"]
    sg1 = r1["matrix"]["steadygate_1_0"]
    sg2 = r1["matrix"]["steadygate_2_0"]

    # Clean commands succeed 100% across all 3 policies
    assert sg1["positive_commands"]["clean_rate_pct"] == 100.0
    assert sg2["positive_commands"]["clean_rate_pct"] == 100.0

    # Negative controls (typing, drinking): Naive triggers false actuations, 1.0 and 2.0 have 0
    assert naive["negative_controls"]["false_actuations"] > 0
    assert sg1["negative_controls"]["false_actuations"] == 0
    assert sg2["negative_controls"]["false_actuations"] == 0

    # Degraded Heater [HIGH]: 1.0 permits commits, 2.0 blocks 100% via HEALTH_LOCKED
    assert sg1["degraded_heater_attempts"]["commits"] == sg1["degraded_heater_attempts"]["n"]
    assert sg2["degraded_heater_attempts"]["commits"] == 0
    assert sg2["degraded_heater_attempts"]["blocked"] == sg2["degraded_heater_attempts"]["n"]


def test_chaos_cli_writes_results_markdown_and_metrics_json(tmp_path: Path) -> None:
    out_md = tmp_path / "RESULTS.md"
    rc = chaos_main(["--seed", "1", "--runs", "40", "--out", str(out_md)])
    assert rc == 0
    assert out_md.exists()

    md_text = out_md.read_text(encoding="utf-8")
    assert "n=40" in md_text
    assert "Seed 1" in md_text
    assert "simulated" in md_text

    metrics_file = tmp_path / "metrics.json"
    assert metrics_file.exists()
    metrics = json.loads(metrics_file.read_text(encoding="utf-8"))
    assert metrics["runs_n"] == 40
    assert metrics["seed"] == 1
