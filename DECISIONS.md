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

## [AD-2026-002] Multi-Agent Enterprise Workflow Matrix
* **Status:** APPROVED
* **Context:** The user requires a standalone, production-grade instructions file (`TEAM_WORK.md`) to establish high-performing, corporate-grade workspace operations across four simulated agent personas (`[Lead Architect]`, `[Implementation Eng]`, `[QA & Chaos Eng]`, `[Principal Reviewer]`) and the 15-Principal-Engineer Microsoft/Google Review Matrix.
* **Decision:** Define a comprehensive, end-to-end framework enforcing standard software engineering patterns (Design Docs, CI/CD gates, chaos engineering, and zero-placeholder rule compliance).
* **Impact:** Elevates the agent execution model to an institutional engineering standard, eliminating technical debt and ensuring absolute execution safety.

## [AD-2026-003] Three Real-World Live Camera Failure Case Guards & Concurrency Hardening
* **Status:** APPROVED
* **Context:** Live webcam testing exposed three concrete failure cases captured in user screenshots:
  1. **Failure Case 1 (`Screenshot 2026-10-16 114707.png` — Smartphone in Hand -> `POINTING_UP`)**: Holding a wide smartphone vertically with the thumb clamping the left edge (`d4_5 = 1.02`, `d4_10 = 1.62`, `d4_14 = 1.75`, `cApertureRatio = 1.53`) and the index finger resting extended along the top edge (`idx = 0.88`) bypassed existing object-grasp guards (which assumed `fourMax < 0.62`) and falsely triggered `POINTING_UP`.
  2. **Failure Case 2 (`Screenshot 2026-10-16 114648.png` — Side-Profile Free Hand -> `PALM_OCCLUDED_BY_OBJECT`)**: Holding an empty free hand in natural 3D radial side profile caused the 4 MCP joints (`5, 9, 13, 17`) to align along the camera axis (`aspect = 4.79 > 3.6`), falsely triggering Guard 1 (`PALM_OCCLUDED_BY_OBJECT`) despite all 4 fingers being cleanly extended (`fourMin = 0.83 >= 0.72`, `palmLen = 0.30 >= 0.22`) with natural radial profile curvature.
  3. **Failure Case 3 (`Screenshot 2026-10-16 121013.png` — Nose Tingling / Face Scratching -> `FIST`)**: Touching/scratching the nose with knuckles near the nose bridge (`mIdx = 8.8°`, `mMid = 13.3°`, acute MCP fold back toward the wrist) and straight PIP segments (`sIdx = 177.6°`, `sMid = 165.2°`) hanging downward over the face produced low radial finger reach (`fourMean = 0.06`) and falsely triggered `FIST`.
* **Decision:**
  1. **Guard 6 (`WIDE_PHONE_OR_OBJECT_CLASP`)**: Block any posture where the thumb opposes the MCP/PIP knuckle line across a wide object span (`d4_5 > 0.72 && d4_10 > 1.10 && d4_14 > 1.10 && Math.max(mid, rng, pnk) < 0.45`), even when the index finger is extended along the top of the phone.
  2. **Side-Profile Free-Hand Exemption in Guard 1**: Exempt natural 3D radial/ulnar side-profile free hands (`aspect > 3.6 && aspect <= 6.2 && palmLen >= 0.22 && fourMin >= 0.70 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.28`) from `PALM_OCCLUDED_BY_OBJECT` so sideways open hands are recognized cleanly without false object-grasp blocks.
  3. **Guard 7 (`CASUAL_FACE_TOUCH_OR_SCRATCH`) + Live Face/Nose ROI Overlap Guard**:
     - Biomechanically reject downward-hanging dorsal/claw face-scratching postures (`Math.min(mIdx, mMid) < 45 && Math.max(sIdx, sMid) > 0.65 && fourMean < 0.35`, OR `faceOverlapDetected === true`), returning `isObjectGrasp: true, reason: "CASUAL_FACE_TOUCH_OR_SCRATCH"` (forced to `UNKNOWN` with `0%` trigger).
     - Add real-time Face/Nose ROI overlap detection in `SceneAnalyzer` (`src/lib/vision-runtime.ts`) and `LiveCameraStream.tsx` to detect when the hand bounding box overlaps the upper-central face/head skin cluster and block accidental face-touching commands.


## [AD-2026-002] Multi-Agent Enterprise Workflow Matrix
* **Status:** APPROVED
* **Context:** The user requires a standalone, production-grade instructions file (`TEAM_WORK.md`) to establish high-performing, corporate-grade workspace operations across four simulated agent personas (`[Lead Architect]`, `[Implementation Eng]`, `[QA & Chaos Eng]`, `[Principal Reviewer]`).
* **Decision:** Define a comprehensive, end-to-end framework enforcing standard software engineering patterns (Design Docs, CI/CD gates, chaos engineering, and zero-placeholder rule compliance).
* **Impact:** Elevates the agent execution model to an institutional engineering standard, eliminating technical debt and ensuring absolute execution safety.

## [AD-2026-003] Three Real-World Live Camera Failure Case Guards
* **Status:** APPROVED
* **Context:** Live webcam testing exposed three concrete failure cases captured in user screenshots:
  1. **Failure Case 1 (`Screenshot 2026-10-16 114707.png` — Smartphone in Hand -> `POINTING_UP`)**: Holding a wide smartphone vertically with the thumb clamping the left edge (`d4_5 = 1.02`, `d4_10 = 1.62`, `d4_14 = 1.75`, `cApertureRatio = 1.53`) and the index finger resting extended along the top edge (`idx = 0.88`) bypassed existing object-grasp guards (which assumed `fourMax < 0.62`) and falsely triggered `POINTING_UP`.
  2. **Failure Case 2 (`Screenshot 2026-10-16 114648.png` — Side-Profile Free Hand -> `PALM_OCCLUDED_BY_OBJECT`)**: Holding an empty free hand in natural 3D radial side profile caused the 4 MCP joints (`5, 9, 13, 17`) to align along the camera axis (`aspect = 4.79 > 3.6`), falsely triggering Guard 1 (`PALM_OCCLUDED_BY_OBJECT`) despite all 4 fingers being cleanly extended (`fourMin = 0.83 >= 0.72`, `palmLen = 0.30 >= 0.22`) with natural radial profile curvature.
  3. **Failure Case 3 (`Screenshot 2026-10-16 121013.png` — Nose Tingling / Face Scratching -> `FIST`)**: Touching/scratching the nose with knuckles near the nose bridge (`mIdx = 8.8°`, `mMid = 13.3°`, acute MCP fold back toward the wrist) and straight PIP segments (`sIdx = 177.6°`, `sMid = 165.2°`) hanging downward over the face produced low radial finger reach (`fourMean = 0.06`) and falsely triggered `FIST`.
* **Decision:**
  1. **Guard 6 (`WIDE_PHONE_OR_OBJECT_CLASP`)**: Block any posture where the thumb opposes the MCP/PIP knuckle line across a wide object span (`d4_5 > 0.72 && d4_10 > 1.10 && d4_14 > 1.10 && Math.max(mid, rng, pnk) < 0.45`), even when the index finger is extended along the top of the phone.
  2. **Side-Profile Free-Hand Exemption in Guard 1**: Exempt natural 3D radial/ulnar side-profile free hands (`aspect > 3.6 && aspect <= 6.2 && palmLen >= 0.22 && fourMin >= 0.70 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.28`) from `PALM_OCCLUDED_BY_OBJECT` so sideways open hands are recognized cleanly without false object-grasp blocks.
  3. **Guard 7 (`CASUAL_FACE_TOUCH_OR_SCRATCH`) + Live Face/Nose ROI Overlap Guard**:
     - Biomechanically reject downward-hanging dorsal/claw face-scratching postures (`Math.min(mIdx, mMid) < 45 && Math.max(sIdx, sMid) > 0.65 && fourMean < 0.35`, OR `faceOverlapDetected === true`), returning `isObjectGrasp: true, reason: "CASUAL_FACE_TOUCH_OR_SCRATCH"` (forced to `UNKNOWN` with `0%` trigger).
     - Add real-time Face/Nose ROI overlap detection in `SceneAnalyzer` (`src/lib/vision-runtime.ts`) and `LiveCameraStream.tsx` to detect when the hand bounding box overlaps the upper-central face/head skin cluster and block accidental face-touching commands.

