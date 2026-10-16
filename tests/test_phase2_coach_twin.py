"""Phase 2 Unit & Integration Tests: FeedforwardCoach and DigitalTwinRoom."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from steadygate.actuator import VirtualActuator
from steadygate.coach import FeedforwardCoach, main as coach_main
from steadygate.config import load_config
from steadygate.events import Observation
from steadygate.policy import SteadyGatePolicy
from steadygate.twin import create_twin_app, main as twin_main


def test_feedforward_coach_renders_progress_ring_and_respects_feature_flag(tmp_path: Path) -> None:
    cfg = load_config()
    policy = SteadyGatePolicy(cfg, actuator=VirtualActuator(cfg))
    coach = FeedforwardCoach(cfg)

    policy.step(0.0, 0, Observation("OPEN_PALM", 0.94, True, 0.92))
    policy.step(0.2, 1, Observation("POINTING_UP", 0.95, True, 0.92))
    policy.step(0.6, 2, Observation("POINTING_UP", 0.95, True, 0.92))

    blank = np.zeros((480, 640, 3), dtype=np.uint8)
    rendered = coach.render(blank, policy)
    assert rendered.shape == (480, 640, 3)
    # Verify header, ring, and footer drew non-zero pixels
    assert int(np.sum(rendered[:54, :])) > 0
    assert int(np.sum(rendered[408:, :])) > 0
    assert int(np.sum(rendered[140:260, 460:580])) > 0

    # Feature flag disabled -> frame unchanged
    cfg_off = deepcopy(cfg)
    cfg_off["features"]["coach_overlay"] = False
    coach_off = FeedforwardCoach(cfg_off)
    unmodified = coach_off.render(blank, policy)
    assert int(np.sum(unmodified)) == 0

    # CLI verification saving PNG
    out_png = tmp_path / "coach_frame.png"
    rc = coach_main(["--out", str(out_png)])
    assert rc == 0
    assert out_png.exists() and out_png.stat().st_size > 500


def test_digital_twin_room_rest_websocket_and_fault_injection() -> None:
    cfg = load_config()
    app = create_twin_app(cfg)
    client = TestClient(app)

    # 1. Dashboard HTML is 100% local (zero external http/https CDN assets)
    res_html = client.get("/")
    assert res_html.status_code == 200
    html_text = res_html.text
    assert "http://" not in html_text
    assert "https://" not in html_text
    for label in ["Lamp", "Fan", "Curtain", "Heater", "simulated"]:
        assert label in html_text

    # 2. Initial state snapshot verifies all 4 devices & risk tiers
    state_res = client.get("/api/state").json()
    assert state_res["feedback_mode"] == "simulated"
    devices = state_res["devices"]
    assert devices["lamp"]["risk_tier"] == "LOW"
    assert devices["fan"]["risk_tier"] == "MEDIUM"
    assert devices["curtain"]["risk_tier"] == "LOW"
    assert devices["heater"]["risk_tier"] == "HIGH"

    # 3. Full commit cycle via POST /api/step
    steps = [
        (0.0, 0, "OPEN_PALM"),
        (0.2, 1, "PINCH"),       # curtain:SET_OPEN (LOW risk, 0.8s hold)
        (0.6, 2, "PINCH"),
        (1.05, 3, "PINCH"),      # reaches 0.85s -> AWAITING_RELEASE
        (1.25, 4, "OPEN_PALM"),  # release -> AWAITING_CONFIRM
        (1.45, 5, "THUMBS_UP"),
        (1.75, 6, "THUMBS_UP"),
        (2.00, 7, "THUMBS_UP"),  # reaches 0.55s >= 0.50s -> COMMIT
    ]
    last_resp = {}
    for t_mono, fid, gest in steps:
        last_resp = client.post(
            "/api/step",
            json={"t_mono": t_mono, "frame_id": fid, "gesture": gest, "score": 0.94},
        ).json()

    assert last_resp["event"]["decision"] == "COMMIT"
    assert last_resp["devices"]["curtain"]["state"] == "OPEN"

    # 4. Fault injection (ACK_MISSING)
    client.post("/api/reset")
    client.post("/api/fault", json={"device_id": "lamp", "drop_ack": True})
    fault_steps = [
        (0.0, 0, "OPEN_PALM"),
        (0.2, 1, "POINTING_UP"),
        (0.6, 2, "POINTING_UP"),
        (1.05, 3, "POINTING_UP"),
        (1.25, 4, "OPEN_PALM"),
        (1.45, 5, "THUMBS_UP"),
        (1.75, 6, "THUMBS_UP"),
        (2.00, 7, "THUMBS_UP"),
    ]
    for t_mono, fid, gest in fault_steps:
        last_resp = client.post(
            "/api/step",
            json={"t_mono": t_mono, "frame_id": fid, "gesture": gest, "score": 0.94},
        ).json()

    assert last_resp["event"]["decision"] == "REJECT"
    assert last_resp["event"]["reason_code"] == "ACK_MISSING"
    assert last_resp["devices"]["lamp"]["state"] == "OFF"

    # 5. WebSocket verification
    client.post("/api/reset")
    with client.websocket_connect("/ws") as ws:
        initial = ws.receive_json()
        assert initial["feedback_mode"] == "simulated"
        ws.send_json(
            {
                "type": "step",
                "t_mono": 0.0,
                "frame_id": 0,
                "observation": {
                    "gesture": "OPEN_PALM",
                    "score": 0.95,
                    "hand_present": True,
                    "landmark_quality": 0.92,
                },
            }
        )
        reply = ws.receive_json()
        assert reply["event"]["state_after"] == "ARMED"

    # 6. Direct Digital Twin /api/actuate ON and OFF verification for all appliances
    client.post("/api/reset")
    for dev_id, on_cmd, on_state, off_cmd, off_state in [
        ("lamp", "SET_ON", "ON", "SET_OFF", "OFF"),
        ("lamp_2", "SET_ON", "ON", "SET_OFF", "OFF"),
        ("fan", "SET_SPEED_2", "SPEED_2", "SET_OFF", "OFF"),
        ("curtain", "SET_OPEN", "OPEN", "SET_CLOSED", "CLOSED"),
        ("heater", "SET_ON", "ON", "SET_OFF", "OFF"),
    ]:
        r_on = client.post("/api/actuate", json={"device_id": dev_id, "command": on_cmd}).json()
        assert r_on["result"]["ok"] is True
        assert r_on["devices"][dev_id]["state"] == on_state
        r_off = client.post("/api/actuate", json={"device_id": dev_id, "command": off_cmd}).json()
        assert r_off["result"]["ok"] is True
        assert r_off["devices"][dev_id]["state"] == off_state

    # 7. CLI --check-only verification
    assert twin_main(["--check-only"]) == 0
