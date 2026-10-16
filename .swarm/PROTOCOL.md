# SteadyGate v4.0 Global — 16-Agent Two-Tier Swarm Communication Protocol

## 1. Architecture Overview
- **Tier 1 (M1–M4 Watchdogs & Orchestrators):** Lock shared contracts (`.swarm/contracts/types.ts`), maintain the shared blackboard (`.swarm/blackboard.json`), dispatch execution waves, and enforce verification gates.
- **Tier 2 (S1–S12 Execution Subagents):** Own strictly partitioned file scopes, read `.swarm/contracts/types.ts`, write structured completion payloads to `.swarm/reports/S*.json`, and never overwrite files outside their assigned scope.

## 2. File-Ownership Matrix
| Agent ID | Domain | Exclusive Write Scope | Verification Gate |
| :--- | :--- | :--- | :--- |
| **M1** | Chief Swarm Orchestrator | `.swarm/blackboard.json`, `.swarm/contracts/types.ts` | Global DAG & contract lock |
| **M2** | Biomechanical & Clinical Watchdog | `.swarm/reviews/biomech-audit.md` | HaGRID $\ge 98.2\%$, Grasp FP $= 0.0\%$ |
| **M3** | Vision Runtime & Hardware Watchdog | `.swarm/reviews/runtime-audit.md` | Pre-proc $< 2.0\text{ ms}$, 12–120 fps sync |
| **M4** | Adversarial QA & Merge Gatekeeper | `.swarm/reviews/qa-gate.json` | `tsc --noEmit` + all CLI suites 100% pass |
| **S1** | 3D Palmar/Dorsal & Side-Profile | `src/lib/biomechanics/palm-orientation.ts` | Case 2 Side-Profile + UK/GR Dorsal V check |
| **S2** | ISO-3166 Locale Cultural Packs | `src/lib/locales/gesture-packs.ts`, `storage/locale_gesture_packs.json` | 0 taboo gestures across 190+ country codes |
| **S3** | Per-Finger ROM & Gravity Normalizer | `src/lib/biomechanics/rom-gravity-normalizer.ts` | $0^\circ\text{–}60^\circ$ incline & arthritic contracture pass |
| **S4** | Levodopa Dyskinesia & Notch Filter | `src/lib/signal-processing.ts` | ON-state $1\text{–}3\text{ Hz}$ chorea + OFF-state $4\text{–}6\text{ Hz}$ pass |
| **S5** | 7-Tier Grasp & Caregiver Bone Lock | `src/lib/hand-gesture-engine.ts` | Case 1, Case 3 + Caregiver intrusion $= 0\%$ FP |
| **S6** | Adaptive MST 1–10 Skin Calibrator | `src/lib/vision/skin-calibrator.ts` | Monk Skin Tone 1–10 + 2700K–6500K parity |
| **S7** | 50/60 Hz Flicker & ROI CLAHE | `src/lib/vision-runtime.ts` | $10\text{ Hz}$ beat cancellation + $< 2\text{ ms}$ budget |
| **S8** | Time-Weighted Voter ($350\text{ ms}$) | `src/lib/voter/time-weighted-voter.ts`, `src/components/LiveCameraStream.tsx` | Identical $350\text{ ms}$ dwell at 12, 30, 60, 120 fps |
| **S9** | 3-Tier Safety Chord Engine | `src/lib/policy/safety-chord-engine.ts` | Tier 3 two-step chord (`OPEN_PALM` $\rightarrow$ `FIST`) |
| **S10** | Local LAN Hardware Bridge | `src/lib/hardware/lan-bridge.ts`, `src/app/api/actuate/route.ts` | 100% offline LAN actuation + circuit breaker |
| **S11** | Admin AI Trainer & FHIR R4 Exporter | `src/app/api/admin-train/route.ts`, `src/components/AdminGestureTrainer.tsx` | 10-way concurrent atomic write + FHIR JSON |
| **S12** | Adversarial Chaos & Global v4 Suite | `tests/global-v4-adversarial.test.ts`, `tests/gesture-robustness.test.ts` | 100% deterministic CI gate (`seed=42`) |
