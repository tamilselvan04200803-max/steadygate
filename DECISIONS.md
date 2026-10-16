# ARCHITECTURAL DECISION RECORDS (`DECISIONS.md`)

Maintained by: 👤 `[Lead Architect Node]`

---

## ADR-001: Coexistence of Legacy TypeScript App and SteadyGate 2.0 Python Package
* **Context:** Repository commit `5cdf58c` contained a Next.js/TypeScript web prototype (`src/`, `tests/gesture-robustness.test.ts`), while the SteadyGate 2.0 Production Engine requires a Python 3.10+ modular architecture (`steadygate`), `config.yaml`, OpenCV ArUco (`cv2.aruco`), MediaPipe Tasks, and `pytest` verification.
* **Decision:** Preserve all existing TypeScript files and tests (`npx tsx tests/gesture-robustness.test.ts`) while implementing the complete SteadyGate 2.0 Python production engine inside `steadygate/`.

## ADR-002: Strict 18-Member `ReasonCode` Enum Across All `DecisionEvent` Records
* **Context:** SteadyGate 2.0 requires 18 exact `ReasonCode` values (`NO_HAND`, `OUTSIDE_ZONE`, `LOW_SCORE`, `UNKNOWN_GESTURE`, `STALE_OBSERVATION`, `TIMESTAMP_GAP`, `HOLD_TOO_SHORT`, `NOT_RELEASED`, `TARGET_CHANGED`, `TIMEOUT`, `USER_CANCEL`, `HEALTH_STRICT`, `HEALTH_LOCKED`, `AMBIGUOUS_TARGET`, `ACK_MISSING`, `OUTCOME_UNKNOWN`, `USER_DISTRACTED`, `DEVICE_FAULT_LOCK`) and a 1-to-1 Recovery Engine map.
* **Decision:** Validate `DecisionEvent.reason_code` against `ReasonCode` on every frame and map `DEVICE_FAULT_LOCK` to `"Action blocked: Target appliance reporting component degradation."`

## ADR-003: ArUco Spatial Anchor Locking (`cv2.aruco`) & Duplicate Appliance Addressing
* **Context:** Casual background hand movements can cause false triggers, and duplicate appliances (e.g., Light Bulb 1 vs. Light Bulb 2) require spatial disambiguation.
* **Decision:** Implement `steadygate/aruco_anchor.py` (`ArucoSpatialAnchorTracker`) using `cv2.aruco.DICT_4X4_50`. Map every appliance in `config.yaml` to a unique ArUco Marker ID (`lamp`: `10`, `lamp_2`: `11`, `fan`: `20`, `curtain`: `30`, `heater`: `40`). Forbid processing a gesture when ArUco spatial locking is active unless the user's hand bounding box/pointing ray intersects the targeted ArUco marker anchor box.

## ADR-004: Face/Gaze Intent Match (`USER_DISTRACTED`)
* **Context:** Users talking with their hands or looking away from the target appliance must not trigger commands.
* **Decision:** Implement `steadygate/face_intent.py` (`FaceIntentTracker`). Require `user_intent_verified: True` (eye gaze vector intersecting the targeted ArUco/appliance bounding box AND head yaw/pitch within `+/- 20.0` degrees of the camera plane) to transition from `HOLD` to execution. Flag non-compliant frames as `UNINTENTIONAL`, abort prediction immediately, and emit `ReasonCode.USER_DISTRACTED`.

## ADR-005: Ampere-Load Dynamic Hand Gesture Timing Matrix
* **Context:** Low-ampere appliances (lamps, curtains) benefit from snappy response times (`0.35s`), whereas high-ampere inductive/resistive loads (fans, heaters) require longer deliberation (`1.20s–1.80s`) scaled by hand tremor.
* **Decision:** Define `ampere_load_matrix` in `config.yaml` (`LOW_AMPERE`: `0.35s` baseline; `MEDIUM_AMPERE`: `1.20s`; `HIGH_AMPERE`: `1.80s`) and compute dynamic hold requirements via:
  $$\text{hold\_required} = \text{load\_ampere\_class\_baseline} \times (1.0 + \text{tremor\_coefficient})$$

## ADR-006: Continuous ML Training Pipeline & Privacy-By-Default Pixel Stripping
* **Context:** Runtime telemetry is needed to train a lightweight gesture model without ever storing raw camera pixels.
* **Decision:** Append `ml_training_payload` inside every step's `DecisionEvent` written to `logs/session_<timestamp>.jsonl`, capturing landmarks, confidence, frame ID, timestamp, lux/brightness, contrast, background entropy, user ID, and tremor coefficient, while `sanitize_frame_for_ml_storage()` enforces `raw_video_pixels_masked: True` and `pixel_array_stored: False`.

## ADR-007: Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK`) & Tri-State Twin Telemetry
* **Context:** Sending `SET` commands to a degraded appliance is unsafe, and showing `"SUCCESS"` when a command was merely sent hides ACK drops or corrupt outcomes.
* **Decision:** Query the target appliance status register (`check_circuit_breaker`) prior to every `SET` command. If `DEFECTIVE`, freeze the loop, emit `DecisionType.CANCEL` with `ReasonCode.DEVICE_FAULT_LOCK`, withhold the physical packet, and alert the Feedforward Coach with `"Action blocked: Target appliance reporting component degradation."` Track `requested_state`, `applied_state`, and `simulated_observed_state` separately on every `VirtualDevice`, and enforce an auto-expiring `ON` timer (`120.0s`) on the `HIGH`-risk `heater`.
