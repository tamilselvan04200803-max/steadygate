"""Digital Twin Room (`steadygate/twin.py`).

FastAPI + WebSocket + Local inline JS/SVG dashboard bound strictly to `127.0.0.1`
(no cloud APIs, no CDN assets). Exposes simulated components:
  - Lamp (ArUco ID 10) [LOW, 0.35s]
  - Lamp 2 (ArUco ID 11) [LOW, 0.35s]
  - Fan (ArUco ID 20) [MEDIUM, 1.20s]
  - Curtain (ArUco ID 30) [LOW, 0.35s]
  - Heater (ArUco ID 40) [HIGH, 1.80s, auto_expire_sec=120.0]
Displays `requested_state`, `applied_state`, and `simulated_observed_state` separately
(never showing `"SUCCESS"` for a command that was only sent!) alongside direct Turn ON /
Turn OFF controls, physical fault injection modules (`delay_ack` / `latency_spike_ms`,
`drop_ack`, `duplicate`, `restart`, `unknown_outcome`, `defective`), and real-time
`policy.describe()` reflection.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from steadygate.actuator import COMMAND_TO_STATE, VirtualActuator
from steadygate.config import load_config
from steadygate.events import ActionCommand, Observation
from steadygate.policy import SteadyGatePolicy

LOCAL_DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>SteadyGate 2.0 — Digital Twin Room (Simulated)</title>
<style>
  :root {
    --bg: #0f172a;
    --panel: #1e293b;
    --border: #334155;
    --text: #f8fafc;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --good: #22c55e;
    --degraded: #f59e0b;
    --poor: #ef4444;
  }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
  body { margin: 0; padding: 20px; background: var(--bg); color: var(--text); }
  .banner {
    background: #172554; border: 1px solid #1d4ed8; padding: 10px 16px;
    border-radius: 8px; margin-bottom: 16px; font-size: 13px;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
  .card {
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; padding: 14px;
  }
  .tier { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 700; }
  .tier-LOW { background: #064e3b; color: #6ee7b7; }
  .tier-MEDIUM { background: #78350f; color: #fcd34d; }
  .tier-HIGH { background: #7f1d1d; color: #fca5a5; }
  .btn {
    background: #334155; color: #fff; border: 1px solid #475569;
    border-radius: 6px; padding: 6px 10px; cursor: pointer; margin: 3px 3px 3px 0; font-size: 12px;
  }
  .btn:hover { background: #475569; }
  .btn-on { background: #059669; border-color: #10b981; font-weight: 700; }
  .btn-on:hover { background: #10b981; }
  .btn-off { background: #e11d48; border-color: #f43f5e; font-weight: 700; }
  .btn-off:hover { background: #f43f5e; }
  pre { background: #020617; padding: 10px; border-radius: 8px; overflow-x: auto; font-size: 12px; }
  .substate { font-size: 12px; color: var(--muted); margin: 4px 0; }
</style>
</head>
<body>
  <div class="banner">
    <strong>STEADYGATE 2.0 DIGITAL TWIN ROOM (SIMULATED)</strong> —
    All device states and feedback shown below are <code>simulated</code> (Requested / Applied / Simulated-Observed shown separately; never reports Sent as Applied). Bound to <code>127.0.0.1</code> (offline-first, zero CDN assets).
  </div>

  <div class="grid" id="device-grid">
    <div class="card" id="card-lamp">
      <h3>Lamp (ArUco #10) <span class="tier tier-LOW">LOW | 0.35s</span></h3>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle id="svg-lamp" cx="32" cy="28" r="16" fill="#475569" stroke="#94a3b8" stroke-width="2"/>
        <rect x="26" y="44" width="12" height="10" fill="#64748b"/>
      </svg>
      <p>State: <strong id="state-lamp">OFF</strong> <em>(simulated)</em></p>
      <p class="substate" id="tri-lamp">Requested: OFF | Applied: OFF | Observed: OFF</p>
      <div>
        <button class="btn btn-on" onclick="actuateDevice('lamp', 'SET_ON')">Turn ON (SET_ON)</button>
        <button class="btn btn-off" onclick="actuateDevice('lamp', 'SET_OFF')">Turn OFF (SET_OFF)</button>
      </div>
    </div>
    <div class="card" id="card-lamp_2">
      <h3>Lamp 2 (ArUco #11) <span class="tier tier-LOW">LOW | 0.35s</span></h3>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle id="svg-lamp_2" cx="32" cy="28" r="16" fill="#475569" stroke="#94a3b8" stroke-width="2"/>
        <rect x="26" y="44" width="12" height="10" fill="#64748b"/>
      </svg>
      <p>State: <strong id="state-lamp_2">OFF</strong> <em>(simulated)</em></p>
      <p class="substate" id="tri-lamp_2">Requested: OFF | Applied: OFF | Observed: OFF</p>
      <div>
        <button class="btn btn-on" onclick="actuateDevice('lamp_2', 'SET_ON')">Turn ON (SET_ON)</button>
        <button class="btn btn-off" onclick="actuateDevice('lamp_2', 'SET_OFF')">Turn OFF (SET_OFF)</button>
      </div>
    </div>
    <div class="card" id="card-fan">
      <h3>Fan (ArUco #20) <span class="tier tier-MEDIUM">MEDIUM | 1.20s</span></h3>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="22" fill="none" stroke="#94a3b8" stroke-width="2"/>
        <path id="svg-fan" d="M32 12 L38 28 L32 32 L26 28 Z M52 32 L36 38 L32 32 L36 26 Z M32 52 L26 36 L32 32 L38 36 Z M12 32 L28 26 L32 32 L28 38 Z" fill="#475569"/>
      </svg>
      <p>State: <strong id="state-fan">OFF</strong> <em>(simulated)</em></p>
      <p class="substate" id="tri-fan">Requested: OFF | Applied: OFF | Observed: OFF</p>
      <div>
        <button class="btn btn-on" onclick="actuateDevice('fan', 'SET_ON')">Turn ON (SET_ON)</button>
        <button class="btn" onclick="actuateDevice('fan', 'SET_SPEED_2')">Speed 2 (SET_SPEED_2)</button>
        <button class="btn btn-off" onclick="actuateDevice('fan', 'SET_OFF')">Turn OFF (SET_OFF)</button>
      </div>
    </div>
    <div class="card" id="card-curtain">
      <h3>Curtain (ArUco #30) <span class="tier tier-LOW">LOW | 0.35s</span></h3>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <rect x="10" y="10" width="44" height="44" fill="none" stroke="#94a3b8" stroke-width="2"/>
        <rect id="svg-curtain-l" x="12" y="12" width="20" height="40" fill="#475569"/>
        <rect id="svg-curtain-r" x="32" y="12" width="20" height="40" fill="#475569"/>
      </svg>
      <p>State: <strong id="state-curtain">CLOSED</strong> <em>(simulated)</em></p>
      <p class="substate" id="tri-curtain">Requested: CLOSED | Applied: CLOSED | Observed: CLOSED</p>
      <div>
        <button class="btn btn-on" onclick="actuateDevice('curtain', 'SET_OPEN')">Open (SET_OPEN)</button>
        <button class="btn btn-off" onclick="actuateDevice('curtain', 'SET_CLOSED')">Close (SET_CLOSED)</button>
      </div>
    </div>
    <div class="card" id="card-heater">
      <h3>Heater (ArUco #40) <span class="tier tier-HIGH">HIGH | 1.80s</span></h3>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <rect x="12" y="16" width="40" height="32" rx="4" fill="none" stroke="#94a3b8" stroke-width="2"/>
        <line id="svg-heater" x1="20" y1="26" x2="44" y2="26" stroke="#475569" stroke-width="4"/>
      </svg>
      <p>State: <strong id="state-heater">OFF</strong> <em>(simulated)</em></p>
      <p class="substate" id="tri-heater">Requested: OFF | Applied: OFF | Observed: OFF</p>
      <div>
        <button class="btn btn-on" onclick="actuateDevice('heater', 'SET_ON')">Turn ON (SET_ON)</button>
        <button class="btn btn-off" onclick="actuateDevice('heater', 'SET_OFF')">Turn OFF (SET_OFF)</button>
      </div>
    </div>
  </div>

  <div class="grid" style="margin-top: 16px;">
    <div class="card">
      <h3>Fault Injection Controls (Simulated)</h3>
      <button class="btn" onclick="injectFault({latency_spike_ms: 450})">Delay ACK (450ms)</button>
      <button class="btn" onclick="injectFault({drop_ack: true})">Drop ACK (ACK_MISSING)</button>
      <button class="btn" onclick="injectFault({duplicate_packet: true})">Duplicate Packet</button>
      <button class="btn" onclick="injectFault({unknown_outcome: true})">Inject OUTCOME_UNKNOWN</button>
      <button class="btn" onclick="injectFault({defective: true, unacknowledged_fault: true})">Inject DEFECTIVE</button>
      <button class="btn" onclick="injectFault({restart: true})">Restart Devices</button>
    </div>
    <div class="card">
      <h3>Policy Reflection (<code>policy.describe()</code>)</h3>
      <pre id="policy-desc">Loading...</pre>
    </div>
  </div>

<script>
  async function refreshState() {
    const res = await fetch('/api/state');
    const data = await res.json();
    updateUI(data);
  }
  function updateUI(data) {
    if (data.devices) {
      for (const [id, dev] of Object.entries(data.devices)) {
        const el = document.getElementById('state-' + id);
        if (el) el.textContent = dev.state;
        const tri = document.getElementById('tri-' + id);
        if (tri) {
          tri.textContent = 'Requested: ' + dev.requested_state +
            ' | Applied: ' + dev.applied_state +
            ' | Observed: ' + dev.simulated_observed_state;
        }
        if (id === 'lamp' || id === 'lamp_2') {
          const bulb = document.getElementById('svg-' + id);
          if (bulb) bulb.setAttribute('fill', dev.state === 'ON' ? '#fbbf24' : '#475569');
        } else if (id === 'fan') {
          const fanSvg = document.getElementById('svg-fan');
          if (fanSvg) fanSvg.setAttribute('fill', dev.state !== 'OFF' && dev.state !== 'UNKNOWN' ? '#38bdf8' : '#475569');
        } else if (id === 'curtain') {
          const cl = document.getElementById('svg-curtain-l');
          const cr = document.getElementById('svg-curtain-r');
          if (cl && cr) {
            cl.setAttribute('width', dev.state === 'OPEN' ? '6' : '20');
            cr.setAttribute('x', dev.state === 'OPEN' ? '46' : '32');
            cr.setAttribute('width', dev.state === 'OPEN' ? '6' : '20');
          }
        } else if (id === 'heater') {
          const hLine = document.getElementById('svg-heater');
          if (hLine) hLine.setAttribute('stroke', dev.state === 'ON' ? '#f97316' : '#475569');
        }
      }
    }
    if (data.policy) {
      document.getElementById('policy-desc').textContent = JSON.stringify(data.policy, null, 2);
    }
  }
  async function actuateDevice(deviceId, command) {
    await fetch('/api/actuate', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({device_id: deviceId, command: command})
    });
    await refreshState();
  }
  async function injectFault(payload) {
    await fetch('/api/fault', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    await refreshState();
  }
  try {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => updateUI(JSON.parse(ev.data));
  } catch (_) {}
  refreshState();
</script>
</body>
</html>
"""


class StepPayload(BaseModel):
    t_mono: float
    frame_id: int
    gesture: str = "OPEN_PALM"
    score: float = 0.92
    hand_present: bool = True
    landmark_quality: float = 0.90
    in_zone: bool = True
    num_hands: int = 1
    target_device: str | None = None
    target_command: str | None = None
    aruco_marker_id: int | None = None
    aruco_anchor_locked: bool | None = None


class ActuatePayload(BaseModel):
    device_id: str
    command: str
    t_mono: float = 0.0


class FaultPayload(BaseModel):
    device_id: str | None = None
    drop_ack: bool | None = None
    unknown_outcome: bool | None = None
    latency_spike_ms: float | None = None
    duplicate_packet: bool | None = None
    defective: bool | None = None
    unacknowledged_fault: bool | None = None
    restart: bool | None = None


class HealthOverridePayload(BaseModel):
    health_level: str


class TwinRuntime:
    """Stateful container linking VirtualActuator, SteadyGatePolicy, and connected WebSockets."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        self.actuator = VirtualActuator(self.config)
        self.policy = SteadyGatePolicy(self.config, actuator=self.actuator)
        self.clients: list[WebSocket] = []

    def snapshot(self) -> dict[str, Any]:
        return {
            "feedback_mode": "simulated",
            "simulated": True,
            "policy": self.policy.describe(),
            "devices": self.actuator.snapshot(),
            "history_count": len(self.actuator.history),
        }

    async def broadcast(self) -> None:
        payload = self.snapshot()
        stale: list[WebSocket] = []
        for ws in self.clients:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            if ws in self.clients:
                self.clients.remove(ws)


def create_twin_app(config: dict[str, Any] | None = None) -> FastAPI:
    """Create the FastAPI Digital Twin Room application."""
    runtime = TwinRuntime(config)
    app = FastAPI(
        title="SteadyGate 2.0 Digital Twin Room (Simulated)",
        version="2.0.0",
    )
    app.state.runtime = runtime

    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        return HTMLResponse(content=LOCAL_DASHBOARD_HTML)

    @app.get("/api/state")
    async def get_state() -> dict[str, Any]:
        return runtime.snapshot()

    @app.post("/api/step")
    async def post_step(payload: StepPayload) -> dict[str, Any]:
        obs = Observation(
            gesture=payload.gesture,
            score=payload.score,
            hand_present=payload.hand_present,
            landmark_quality=payload.landmark_quality,
            in_zone=payload.in_zone,
            num_hands=payload.num_hands,
            target_device=payload.target_device,
            target_command=payload.target_command,
            aruco_marker_id=payload.aruco_marker_id,
            aruco_anchor_locked=payload.aruco_anchor_locked,
        )
        event = runtime.policy.step(payload.t_mono, payload.frame_id, obs)
        await runtime.broadcast()
        return {
            "feedback_mode": "simulated",
            "event": event.to_dict(),
            "policy": runtime.policy.describe(),
            "devices": runtime.actuator.snapshot(),
        }

    @app.post("/api/actuate")
    async def post_actuate(payload: ActuatePayload) -> dict[str, Any]:
        dev = runtime.actuator.get_device(payload.device_id)
        target_state = COMMAND_TO_STATE.get(payload.command, "ON")
        action = ActionCommand(
            device_id=dev.device_id,
            command=payload.command,
            target_state=target_state,
            risk_tier=dev.risk_tier,
            simulated=True,
        )
        result = runtime.actuator.execute(action, t_mono=payload.t_mono)
        await runtime.broadcast()
        return {
            "feedback_mode": "simulated",
            "result": result.to_dict(),
            "policy": runtime.policy.describe(),
            "devices": runtime.actuator.snapshot(),
        }

    @app.post("/api/fault")
    async def post_fault(payload: FaultPayload) -> dict[str, Any]:
        runtime.actuator.set_fault(
            payload.device_id,
            drop_ack=payload.drop_ack,
            unknown_outcome=payload.unknown_outcome,
            latency_spike_ms=payload.latency_spike_ms,
            duplicate_packet=payload.duplicate_packet,
            defective=payload.defective,
            unacknowledged_fault=payload.unacknowledged_fault,
            restart=payload.restart,
        )
        await runtime.broadcast()
        return runtime.snapshot()

    @app.post("/api/health")
    async def post_health(payload: HealthOverridePayload) -> dict[str, Any]:
        runtime.policy.set_health_level(payload.health_level)
        await runtime.broadcast()
        return runtime.snapshot()

    @app.post("/api/reset")
    async def post_reset() -> dict[str, Any]:
        runtime.actuator = VirtualActuator(runtime.config)
        runtime.policy = SteadyGatePolicy(runtime.config, actuator=runtime.actuator)
        await runtime.broadcast()
        return runtime.snapshot()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        runtime.clients.append(websocket)
        try:
            await websocket.send_json(runtime.snapshot())
            while True:
                msg = await websocket.receive_json()
                action_type = msg.get("type")
                if action_type == "step":
                    obs = Observation.from_dict(msg.get("observation", {}))
                    ev = runtime.policy.step(
                        float(msg.get("t_mono", 0.0)),
                        int(msg.get("frame_id", 0)),
                        obs,
                    )
                    await websocket.send_json(
                        {
                            "feedback_mode": "simulated",
                            "event": ev.to_dict(),
                            "policy": runtime.policy.describe(),
                            "devices": runtime.actuator.snapshot(),
                        }
                    )
                elif action_type == "actuate":
                    dev = runtime.actuator.get_device(str(msg.get("device_id", "lamp")))
                    cmd = str(msg.get("command", "SET_ON"))
                    action = ActionCommand(
                        device_id=dev.device_id,
                        command=cmd,
                        target_state=COMMAND_TO_STATE.get(cmd, "ON"),
                        risk_tier=dev.risk_tier,
                        simulated=True,
                    )
                    runtime.actuator.execute(action, t_mono=float(msg.get("t_mono", 0.0)))
                    await runtime.broadcast()
                elif action_type == "fault":
                    runtime.actuator.set_fault(
                        msg.get("device_id"),
                        drop_ack=msg.get("drop_ack"),
                        unknown_outcome=msg.get("unknown_outcome"),
                        latency_spike_ms=msg.get("latency_spike_ms"),
                        duplicate_packet=msg.get("duplicate_packet"),
                        defective=msg.get("defective"),
                        unacknowledged_fault=msg.get("unacknowledged_fault"),
                        restart=msg.get("restart"),
                    )
                    await runtime.broadcast()
                else:
                    await websocket.send_json(runtime.snapshot())
        except WebSocketDisconnect:
            if websocket in runtime.clients:
                runtime.clients.remove(websocket)

    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="steadygate.twin",
        description="Launch the SteadyGate 2.0 Digital Twin Room FastAPI server on 127.0.0.1",
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to config.yaml")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind host (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8765, help="Bind port (default 8765)")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Instantiate app, verify routes and simulated devices, then exit",
    )
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    app = create_twin_app(cfg)
    if args.check_only:
        snap = app.state.runtime.snapshot()
        devs = ", ".join(
            f"{d['name']} [{d['risk_tier']}]={d['state']}" for d in snap["devices"].values()
        )
        print(
            f"DigitalTwinRoom verified on {args.host}:{args.port} | "
            f"feedback_mode={snap['feedback_mode']} | devices: {devs}"
        )
        return 0

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
