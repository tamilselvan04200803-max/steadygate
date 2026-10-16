# CHANGELOG (`CHANGELOG.md`)

All notable changes to the SteadyGate 1.0 to 2.0 upgrade are documented in this file.

---

## [2.0.0-Alpha.3] - 2026-10-16
### Added & Fixed
- **Guard 6 (`WIDE_PHONE_OR_OBJECT_CLASP` in `src/lib/hand-gesture-engine.ts`)**: Resolved Failure Case 1 (`Screenshot 2026-10-16 114707.png` — holding a smartphone with index extended along top edge misclassified as `POINTING_UP`) by blocking wide opposing thumb-to-knuckle spans (`d4_5 > 0.72 && d4_10 > 1.10 && d4_14 > 1.10 && Math.max(mid, rng, pnk) < 0.45`).
- **Side-Profile Free-Hand Exemption (`src/lib/hand-gesture-engine.ts`)**: Resolved Failure Case 2 (`Screenshot 2026-10-16 114648.png` — empty side-profile hand falsely blocked as `PALM_OCCLUDED_BY_OBJECT`) by exempting natural 3D side-profile hands (`aspect > 3.6 && aspect <= 6.2 && palmLen >= 0.22 && fourMin >= 0.70 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.28`) so they classify cleanly as `OPEN_PALM`.
- **Guard 7 (`CASUAL_FACE_TOUCH_OR_SCRATCH`) + Face/Nose ROI Overlap Guard (`src/lib/hand-gesture-engine.ts`, `src/lib/vision-runtime.ts`, `src/components/LiveCameraStream.tsx`)**: Resolved Failure Case 3 (`Screenshot 2026-10-16 121013.png` — nose tingling / face scratching misclassified as `FIST`) via dual biomechanical dorsal/scratch rejection (`Math.min(mIdx, mMid) < 45 && Math.max(sIdx, sMid) > 0.65 && fourMean < 0.35`) and live upper-central Face/Nose ROI skin-cluster overlap detection.

---

## [2.0.0-Alpha.2] - 2026-10-16
### Added
- Created `TEAM_WORK.md` incorporating enterprise software development lifecycle specifications across the 4-role virtual team (`[Lead Architect]`, `[Implementation Eng]`, `[QA & Chaos Eng]`, `[Principal Reviewer]`).
- Updated `DECISIONS.md` (`[AD-2026-002]` & `[AD-2026-003]`) to establish corporate multi-agent workflows and live camera failure-case guards.

---

## [2.0.0-unified-hub] - 2026-10-15
### Added & Fixed
- **Unified Single-Origin Hub (`ADR-006`)**: Integrated the interactive Smart-House Digital Twin directly into the main Next.js application (`port 3000`) and stopped the disconnected standalone port `8765` preview so gesture recognition, appliance state, and simulation run on a single unified origin.
- **60-Second Personalized Enrolment (`src/components/EnrolmentModal.tsx`, `src/app/api/enrol/route.ts`)**: Extended enrolment duration from `10s` to `60s` (`1,800` frames at `30 Hz` across 4 guided 15-second posture stages) capturing dominant tremor frequency (`f0Hz`), RMS amplitude, band-stop filter range, palm scale, finger flexibility, per-finger extension baselines, and 60s fatigue drift.
- **Continuous Background User Data Storage (`src/lib/storage-logger.ts`, `src/app/api/user-data/route.ts`)**: Added background telemetry & morphology collection every 4s and during enrolment/actuation, persisting to `storage/users_personalized.json`, `storage/user_<id>_profile.json`, `storage/appliance_states.json`, `logs/user_observations.jsonl`, `logs/enrolment_history.jsonl`, and `logs/actuation_events.jsonl`.
- **Default Gesture-to-Appliance Mapping & Auto-Actuation (`src/lib/default-gesture-map.ts`, `src/app/page.tsx`, `src/app/api/actuate/route.ts`)**: Mapped default hand gestures (`OPEN_PALM` -> `fan_table`, `POINTING_UP` -> `lamp_desk`, `VICTORY` -> `ac_living`, `PINCH` -> `blinds_window`, `THUMBS_UP` -> `heater_radiant`, `THUMBS_DOWN` -> `tv_ambient`, `FIST` -> `door_deadbolt`) with live auto-hold actuation and dashboard notification banner/toasts.
- **Appliance Power Toggle & Fan Rotor SVG Fix (`src/components/LiveHouseScene.tsx`, `src/components/SmartHouseSimulator.tsx`, `src/components/ApplianceCardGrid.tsx`)**: Fixed the fan blade CSS `transform-box` wobble glitch using hub-centered SVG `<animateTransform type="rotate" from="0 0 0" to="360 0 0" />`, and added working `Turn ON / Turn OFF` buttons to every appliance across all views.
- **Frontend Cleanup (`src/components/Header.tsx`)**: Removed unused/unwanted frontend pages (`PatentDisclosureView.tsx`, `AdminAgentConsole.tsx`, `BenchmarkLab.tsx`).

---

## [2.0.0-phase5] - 2026-10-15
### Added
- `steadygate/plugins.py`: `GesturePerformanceOptimizer` generating per-gesture telemetry statistics and bounded threshold recommendations with explicit `n` counts, plus `WebhookAdapter` local-only stub (`127.0.0.1` / `localhost`, `dry_run=True`, zero external network side-effects) integrated with `VirtualActuator`.
- `tests/test_phase5_plugins.py`: Unit and CLI tests verifying `WebhookAdapter` local-host enforcement, zero external side-effects, `VirtualActuator` integration, and `GesturePerformanceOptimizer` telemetry output.

---

## [2.0.0-phase4] - 2026-10-15
### Added
- `steadygate/chaos.py`: Deterministic Chaos Lab stress engine (`python -m steadygate.chaos --seed <int> --runs <int> --out <path>`) injecting score noise, observation flicker, timestamp gaps, and degraded telemetry across positive command streams and negative controls (typing, drinking).
- Comparative matrix analytics comparing `Naive Single-Frame Trigger` vs. `SteadyGate 1.0 Policy` vs. `SteadyGate 2.0 Adaptive Strictness`, generating `reports/RESULTS.md` and `reports/metrics.json` with explicit `n` sample counts.
- `tests/test_phase4_chaos.py`: Unit and CLI tests verifying deterministic reproducibility, negative control suppression, high-risk degraded telemetry blocking, and report generation.

---

## [2.0.0-phase3] - 2026-10-15
### Added
- `steadygate/health.py`: `TelemetryHealthEvaluator` rolling-window evaluator tracking frame brightness, wrist jitter, tracking FPS, and detection reliability with a dual-threshold hysteresis engine (`GOOD`, `DEGRADED`, `POOR`).
- Adaptive Strictness in `steadygate/policy.py`: `DEGRADED` mode doubles hold and confirmation durations (`HEALTH_STRICT`), `POOR` mode activates `HEALTH_LOCKED`, and `HIGH` risk tier devices (`heater`) require `GOOD` health status exclusively.
- `tests/test_phase3_health.py`: Unit tests verifying hysteresis deadbands, rolling window degradation, `DEGRADED` double-hold enforcement, `POOR` lockouts, and `Heater [HIGH]` `GOOD`-only protection.

---

## [2.0.0-phase2] - 2026-10-15
### Added
- `steadygate/coach.py`: `FeedforwardCoach` OpenCV overlay bound strictly to `policy.describe()`, drawing a hold-progress ring, active state & health badges, available next actions, and recovery strings.
- `steadygate/twin.py`: `DigitalTwinRoom` FastAPI + WebSocket + inline local JS/SVG dashboard bound to `127.0.0.1` (zero CDN assets), exposing simulated components (`Lamp [LOW]`, `Fan [MEDIUM]`, `Curtain [LOW]`, `Heater [HIGH]`) and fault injection controls (`drop_ack`, `unknown_outcome`, `latency_spike_ms`).
- `tests/test_phase2_coach_twin.py`: Unit, REST, WebSocket, and CLI tests for `FeedforwardCoach` and `DigitalTwinRoom`.

---

## [2.0.0-phase1] - 2026-10-15
### Added
- `steadygate/recorder.py`: `FlightRecorder` streaming validated `DecisionEvent` JSONL lines to `logs/session_<timestamp>.jsonl`, plus `load_session_events` and `latest_session_path`.
- `steadygate/explain.py`: CLI (`python -m steadygate.explain --log <path> --at <seconds>`) displaying real-time transition status, plain-language recovery message, and counterfactual analysis.
- `steadygate/replay.py`: CLI (`python -m steadygate.replay --log <path>`) deterministically re-executing `SteadyGatePolicy` on recorded logs to verify 100% state-for-state fidelity and detect tampering.
- `tests/test_phase1_recorder_replay.py`: Unit and CLI tests for `FlightRecorder`, `steadygate.explain`, and `steadygate.replay`.

---

## [2.0.0-phase0] - 2026-10-15
### Added
- `AUDIT.md`: Direct audit comparing SteadyGate 1.0 claims against the initial repository (`5cdf58c`).
- `PLAN_2.0.md`: File-level schematic blueprint and state-machine transition specification.
- `DECISIONS.md`: Architectural Decision Records (ADR-001 through ADR-005).
- `config.yaml`: Centralized configuration with feature flags (`flight_recorder`, `coach_overlay`, `digital_twin`, `adaptive_health`, `chaos_lab`, `webhook_adapter`, `privacy_record_consent`).
- Core foundation package (`steadygate/`):
  - `steadygate/events.py`: `DecisionEvent` JSONL schema, 16-member `ReasonCode` enum, `Observation`, `ActionCommand`.
  - `steadygate/recovery.py`: Strict 1-to-1 `ReasonCode` recovery message engine using observable conditions only.
  - `steadygate/policy.py`: Pure-Python `SteadyGatePolicy` state machine (`arm -> request -> sustained hold -> release -> fresh confirm`, cancel/timeout) and `policy.describe()` reflection API.
  - `steadygate/actuator.py`: `VirtualActuator` with simulated device state feedback (`"simulated"`) and fault injection.
  - `steadygate/vision.py`: MediaPipe Tasks `HandLandmarker` (`VIDEO` mode, monotonic timestamps) + landmark classifier + privacy-safe `--record` logger.
  - `steadygate/__main__.py`: CLI entrypoint (`python -m steadygate`).
- `tests/test_phase0_foundation.py`: Unit tests covering schema validation, reason codes, recovery engine, fake-clock policy transitions (including `t_mono=0.0`), actuator fault injection, and MediaPipe `VIDEO` mode execution.
