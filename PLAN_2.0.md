# STEADYGATE 2.0 FILE-LEVEL BLUEPRINT (`PLAN_2.0.md`)

**Date:** 2026-10-15  
**Target System:** Windows 11 PowerShell / Python 3.10+ / Local MediaPipe + OpenCV ArUco (`cv2.aruco`)  
**Teamwork Protocol:** `[ANTIGRAVITY SWARM SYNCHRONIZATION AND ANTI-DEVIATION GATEWAY]`  
**Authors:** 👤 `[Lead Architect Node]`, 💻 `[Implementation Engineer Node]`, 🧪 `[QA & Chaos Engineer Node]`, 🧐 `[Principal Reviewer & Gatekeeper Node]`

---

## 1. File-Level Architecture Plan (Phase 0 to Phase 5)

| File Path | Phase | Responsibility |
| :--- | :---: | :--- |
| `AUDIT.md` | Phase 0 | Direct comparison of what exists, what was missing, and what 1.0 claims vs. what runs. |
| `PLAN_2.0.md` | Phase 0 | Complete file-level architectural blueprint and state-machine specification. |
| `DECISIONS.md` | Phase 0–5 | Architectural decision records (`ADR-001` through `ADR-010`) maintained by `[Lead Architect Node]`. |
| `config.yaml` | Phase 0–5 | Central configuration for policy thresholds, `"heuristic, tuned via Chaos Lab"` health thresholds, ArUco marker spatial registry, Ampere-Load timing matrix (`0.35s` low-ampere vs. `1.20s–1.80s` high-ampere), and device definitions (`lamp`, `lamp_2`, `fan`, `curtain`, `heater`). |
| `steadygate/config.py` | Phase 0 | `pathlib` + `PyYAML` configuration loader with deep defaults and feature flag helpers. |
| `steadygate/events.py` | Phase 1 | `ReasonCode` (18 strict enum values including `USER_DISTRACTED` and `DEVICE_FAULT_LOCK`), `PolicyState` (including `AMBIGUOUS_STATE`), `Observation`, `ActionCommand`, `DecisionEvent` with nested `ml_training_payload`, and `sanitize_frame_for_ml_storage()`. |
| `steadygate/recovery.py` | Phase 1 | 1-to-1 plain-language recovery message lookup for all 18 `ReasonCode` values, including `DEVICE_FAULT_LOCK` (`"Action blocked: Target appliance reporting component degradation."`). |
| `steadygate/recorder.py` | Phase 1 | `FlightRecorder` streaming validated `DecisionEvent` JSONL lines with `ml_training_payload` and raw-pixel privacy safeguard verification to `logs/session_<timestamp>.jsonl`. |
| `steadygate/explain.py` | Phase 1 | `python -m steadygate.explain <log> --at <seconds>` CLI printing the surrounding timeline window and plain-language counterfactuals computed from logged values. |
| `steadygate/replay.py` | Phase 1 | `python -m steadygate.replay <log>` CLI re-running `SteadyGatePolicy` deterministically on recorded observation streams and verifying 100% decision reproduction. |
| `steadygate/aruco_anchor.py` | Phase 2 | `ArucoSpatialAnchorTracker` using `cv2.aruco` (`DICT_4X4_50`) to detect physical/synthetic ArUco markers on appliances (including duplicate appliances `lamp` [ID 10] and `lamp_2` [ID 11]) and lock gesture processing to the targeted marker anchor box. |
| `steadygate/face_intent.py` | Phase 2 | `FaceIntentTracker` running concurrent local MediaPipe Face Mesh / geometric pose verification checking gaze intersection with the targeted ArUco/appliance zone and `+/- 20.0 deg` head engagement (`USER_DISTRACTED`). |
| `steadygate/adaptation.py` | Phase 2–3 | `EnvironmentalAdaptationEngine` maintaining a 90-frame sliding window for low-lux `0.15` confidence scaling, background entropy isolation, EMA hand tremor filtering, and Ampere-Load dynamic hold calculation `hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)`. |
| `steadygate/coach.py` | Phase 2 | `FeedforwardCoach` OpenCV HUD overlay generated strictly from `policy.describe()` showing state, valid next gestures, hold-progress ring, interaction zone, ArUco anchor alignment indicators, circuit-breaker alert banner, and recovery strings. |
| `steadygate/twin.py` | Phase 2 | Local FastAPI + WebSocket + inline JS/SVG Digital Twin Room (`127.0.0.1`) displaying `requested_state`, `applied_state`, and `simulated_observed_state` separately for `lamp`, `fan`, `curtain`, and `heater` [HIGH], plus fault injection (`delay ACK`, `drop ACK`, `duplicate`, `restart`, `defective`). |
| `steadygate/health.py` | Phase 3 | Rolling-window `TelemetryHealthEvaluator` (detection rate, mean score, wrist jitter, brightness, FPS) outputting `GOOD` / `DEGRADED` / `POOR` with hysteresis using thresholds labeled `"heuristic, tuned via Chaos Lab"`. |
| `steadygate/actuator.py` | Phase 3–4 | `VirtualActuator` tracking `requested_state`, `applied_state`, and `simulated_observed_state`, enforcing the `DEFECTIVE` Circuit Breaker (`DEVICE_FAULT_LOCK`), and managing the auto-expiring `ON` timer (`120.0s`) for the `HIGH`-risk `heater`. |
| `steadygate/policy.py` | Phase 1–4 | Pure-Python `SteadyGatePolicy` integrating ArUco spatial anchor locking, Face/Gaze intent verification, Ampere-Load timing matrix, Session Health strictness, and Actuator Health Circuit Breaker. |
| `steadygate/chaos.py` | Phase 4 | `python -m steadygate.chaos --seed 1 --runs 200 --out reports/` applying 8 Level-1 observation perturbations (`frame_drop`, `label_flicker`, `score_noise`, `timestamp_jitter`, `latency_spike`, `landmark_dropout`, `hand_loss_burst`, `duplicate_frames`) and Level-2 image transforms, comparing Controllers A, B, and C, and outputting `reports/RESULTS.md` and `reports/results.csv`. |
| `steadygate/plugins.py` | Phase 5 | Gesture Fit Report generator (per-gesture success, confusions, background-trigger count from recorded trials) and modular output adapters (`VirtualActuator` default, offline `WebhookAdapter` stub). |
| `tests/test_phase0_foundation.py` .. `tests/test_phase6_production_refactor.py` | Phase 0–5 | Deterministic `pytest` verification suite covering all phases and architectural upgrades. |
