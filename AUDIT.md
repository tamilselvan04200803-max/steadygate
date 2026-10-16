# STEADYGATE 1.0 -> 2.0 REPOSITORY AUDIT (`AUDIT.md`)

**Date:** 2026-10-15  
**Audited Baseline Commit:** `5cdf58cc15ccf608efcc4d3d236bdc5fc2d308ed` (`main`)  
**Pipeline Stage:** Phase 0 — Repository Audit & Schematic Design  
**Reviewed By:** 👤 `[Lead Architect Node]`, 💻 `[Implementation Engineer Node]`, 🧪 `[QA & Chaos Engineer Node]`, 🧐 `[Principal Reviewer & Gatekeeper Node]`

---

## 1. Executive Summary

An exhaustive file-level audit of the repository reveals what existed in the 1.0 baseline (`5cdf58c`), what was missing, and where 1.0 documentation claims diverged from actual code execution:

1. **What Existed in 1.0 (`5cdf58c`):**
   - A Next.js 16 / TypeScript web application (`src/`, `public/`, `tests/gesture-robustness.test.ts`) with a vendored MediaPipe model (`public/models/hand_landmarker.task`) and a 17-test TypeScript gesture classifier suite.
2. **What Was Missing in 1.0:**
   - Zero Python 3.10+ package modules (`steadygate/`), zero `config.yaml` policy/health/ampere/ArUco configuration, zero JSONL Flight Recorder (`steadygate/recorder.py`), zero CLI counterfactual explainer (`steadygate/explain.py`), zero deterministic replay verifier (`steadygate/replay.py`), zero OpenCV ArUco spatial anchor locking (`steadygate/aruco_anchor.py`), zero concurrent Face/Gaze intent verifier (`steadygate/face_intent.py`), zero Ampere-Load dynamic timing matrix, zero Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK`), and zero Chaos Lab stress harness (`steadygate/chaos.py`).

---

## 2. Direct Comparison: What 1.0 Claims vs. What Actually Runs

| Subsystem / Claim | What 1.0 Claims | What Actually Runs in 1.0 Baseline (`5cdf58c`) | SteadyGate 2.0 Remediation |
| :--- | :--- | :--- | :--- |
| **Spatial Anchor Locking (`cv2.aruco`)** | Target specific physical/virtual appliances without casual background movements triggering actions. | No ArUco marker detection existed; any hand gesture anywhere in the generic ROI triggered an appliance action, and duplicate appliances (e.g., Light Bulb 1 vs. Light Bulb 2) could not be spatially disambiguated. | Implemented `steadygate/aruco_anchor.py` using `cv2.aruco` (`DICT_4X4_50`) mapping unique Marker IDs (`lamp`: `10`, `lamp_2`: `11`, `fan`: `20`, `curtain`: `30`, `heater`: `40`) and enforcing spatial hand-to-marker anchor locking. |
| **Face/Gaze Intent Verification (`USER_DISTRACTED`)** | Ignore incidental hand movements while talking with hands or looking away from the target zone. | No face or eye-gaze tracking existed; looking away (`> +/-20 deg`) while gesturing still triggered commands. | Implemented `steadygate/face_intent.py` (`FaceIntentTracker`) enforcing gaze intersection with the target ArUco/appliance zone and `+/- 20.0 deg` head engagement tolerance, rejecting with `USER_DISTRACTED`. |
| **Ampere-Load Dynamic Timing Matrix** | Scale gesture hold duration by electrical load class and user hand tremor (`hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)`). | Fixed static dwell times were used without an electrical ampere-load baseline matrix. | Configured `ampere_load_matrix` in `config.yaml` (`0.35s` for Low-Ampere `lamp`/`lamp_2`/`curtain`; `1.20s`–`1.80s` for High-Ampere `fan`/`heater`) scaled by `(1.0 + tremor_coefficient)`. |
| **Continuous ML Training Pipeline & Privacy Safeguard** | Log structured geometric training telemetry per frame while strictly stripping raw video pixels. | Browser telemetry posted to PGlite without a JSONL `ml_training_payload` schema or explicit pixel-zeroing safeguard. | Embedded `ml_training_payload` inside every `DecisionEvent` written to `logs/session_<timestamp>.jsonl` with `sanitize_frame_for_ml_storage()` enforcing `raw_video_pixels_masked: True` and `pixel_array_stored: False`. |
| **Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK`)** | Query target appliance status register before issuing `SET` commands and block defective appliances. | Commands were dispatched without checking a hardware status register or alerting the coach overlay on component degradation. | Implemented `VirtualActuator.check_circuit_breaker()` and `SteadyGatePolicy._commit()` lock emitting `CANCEL` + `DEVICE_FAULT_LOCK` and alerting `FeedforwardCoach`: `"Action blocked: Target appliance reporting component degradation."` |
| **State Separation (`requested` / `applied` / `simulated_observed`)** | Digital Twin never shows `"SUCCESS"` for a command that was only sent; displays requested, applied, and simulated-observed states separately. | 1.0 UI toggled appliance state immediately on request without separating requested, applied, and simulated-observed registers. | Updated `VirtualActuator` and `steadygate/twin.py` to track and display `requested_state`, `applied_state`, and `simulated_observed_state` separately alongside `delay_ack`, `drop_ack`, `duplicate`, `restart`, and `defective` fault controls. |
| **Empirical Chaos Lab Benchmark (`n=200`, `--seed 1`)** | Report only executed metrics with explicit sample size `n` and deterministic seed. | `src/app/api/benchmark/route.ts` returned static literals without running a simulation loop. | Implemented `steadygate/chaos.py` (`--seed 1 --runs 200 --out reports/`) applying 8 Level-1 observation perturbations and Level-2 image perturbations, outputting `reports/RESULTS.md`, `reports/results.csv`, and `reports/metrics.json`. |

---

## 3. Gatekeeper Sign-Off (`PHASE 0 - AUDIT`)

- 👤 **[Lead Architect Node]:** `AUDIT.md`, `PLAN_2.0.md`, and `DECISIONS.md` verified complete.
- 🧐 **[Principal Reviewer & Gatekeeper Node]:** Phase 0 signed off. Cleared to proceed sequentially through Phases 1–5.
