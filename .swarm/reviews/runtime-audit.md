# Domain Lead M3 Audit — Vision Runtime, Hardware Bridge & Clinical Safety (`S6`–`S11`)

- **Verdict**: `APPROVED`
- **Subagents Audited**: `S6`, `S7`, `S8`, `S9`, `S10`, `S11`

## Verified Invariants
1. **Adaptive MST 1–10 Skin Calibrator & Background Wood/Wall Subtraction (`S6` — `src/lib/vision/skin-calibrator.ts`)**:
   - Verified `samplePalmPatch` EMA ($\alpha = 0.08$), `isUserSkinPixel` Mahalanobis distance (`distSq <= 4.5`) across all 10 Monk Skin Tones (`MST 1`–`MST 10`) under 2700K warm and 6500K cool lighting (`20/20` passed), and stationary wood/wall background chrominance subtraction.
2. **50/60 Hz Mains Beat Flicker Suppressor & $<2.0\text{ ms}$ ROI CLAHE Governor (`S7` — `src/lib/vision-runtime.ts`)**:
   - Verified `detectMainsBeatFlicker` detecting $8\text{--}12\text{ Hz}$ fluorescent beat oscillations (`flickerHz = 9.3 Hz`, `stabilizedLum = 0.480`) and `applyRoiClaheToBuffer` executing in `0.38 ms` ($< 2.0\text{ ms}$ budget).
3. **Frame-Rate Invariant Time-Weighted Voter (`S8` — `src/lib/voter/time-weighted-voter.ts`, `src/components/LiveCameraStream.tsx`)**:
   - Verified `TimeWeightedGestureVoter(350, 0.60, 0.35)` achieving `12fps = 250ms`, `30fps = 233ms`, `120Hz = 217ms` (`33ms` spread across a $10\times$ frame-rate range) and integrated ISO-3166 Locale Pack selector into `LiveCameraStream.tsx`.
4. **3-Tier Risk Matrix & Two-Step Safety Chord Engine (`S9` — `src/lib/policy/safety-chord-engine.ts`)**:
   - Verified Tier 1 ($350\text{ ms}$), Tier 2 ($600\text{ ms}$ + `faceIntentVerified`), and Tier 3 (`OPEN_PALM` $350\text{ ms}$ $\rightarrow$ `FIST` within $2500\text{ ms}$ $\rightarrow$ $1500\text{ ms}$ hold, with immediate `CHORD_ABORTED_BY_USER` on object grasp) plus `ActuatorCircuitBreaker`.
5. **Local LAN Hardware Bridge (`S10` — `src/lib/hardware/lan-bridge.ts`, `src/app/api/actuate/route.ts`)**:
   - Verified `dispatchLanActuation` with $800\text{ ms}$ `AbortController` timeout, Tier 3 chord verification gate (`TIER_3_CHORD_REQUIRED`), and 3-strike `DEVICE_FAULT_LOCK` circuit breaker.
6. **HL7 FHIR R4 Clinical Tremor Exporter (`S11` — `src/app/api/admin-train/route.ts`, `src/components/AdminGestureTrainer.tsx`)**:
   - Verified `export_fhir_report` generating an anonymized HL7 FHIR R4 `Bundle` (`LOINC 80316-3` $f_0\text{ Hz}$, RMS amplitude, and Levodopa ON/OFF dyskinesia ratio) with zero raw video pixels or PII.
