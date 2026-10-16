# Architectural Decision Records (`DECISIONS.md`)

This document records the core technical decisions, root-cause failure analyses, biomechanical and signal invariants, and verification gates for SteadyGate.

---

## ADR-001: Unified Next.js / TypeScript Runtime (`src/*`) & Optional Python Hardware Harness (`steadygate/*`)
* **Context:** SteadyGate's live perception, tremor filtering, intent gating, Admin AI Trainer, and smart-home Digital Twin run in Next.js and TypeScript (`src/lib/hand-gesture-engine.ts`, `src/lib/vision-runtime.ts`, `src/lib/signal-processing.ts`, `src/components/LiveCameraStream.tsx`, `src/app/api/admin-train/route.ts`) with zero external cloud dependencies. A separate Python package (`steadygate/*`) provides offline ArUco spatial anchor testing, physical relay/serial actuation hooks, and deterministic CLI chaos evaluation.
* **Decision:** Keep the primary web runtime 100% unified in TypeScript (Modules 1–4) so browser-based camera inference, CLAHE pre-processing, tremor personalization, and PGlite persistence execute in a single process without requiring a Python microservice. Retain `steadygate/*` strictly as an optional offline evaluation and physical IoT relay test suite.

---

## ADR-002: HaGRID 17,213-Sample Biomechanical Calibration & Foreshortening Invariance
* **Root Cause:** Standard 2D Euclidean wrist-to-tip distances break when the hand tilts toward the camera ($y \times 0.6$ foreshortening) or turns sideways (e.g., `like` / `THUMBS_UP` where curled fingers project sideways and appear extended in 2D).
* **Biomechanical Invariant:** Calibrated against $N = 17,213$ real human MediaPipe 21-landmark samples across 10 classes from HaGRID (`Raoina/Hand-Gesture-Classification`):
  - **Tip-Over-PIP Radial Ratio:** Curled fingers satisfy $\text{dist}(0, \text{tip}) / \text{dist}(0, \text{pip}) \in [0.42, 0.92]$, whereas extended fingers satisfy $[1.28, 1.45]$ regardless of 2D foreshortening.
  - **Palm-Scale Normalization:** Normalize reach against $\text{baseScale} = \max(L_{\text{palm}}, 0.85 \cdot W_{\text{palm}})$ and damp `fingerExt` whenever $\text{dist}(0, \text{tip}) / \text{dist}(0, \text{pip}) < 1.16$ or $\text{dist}(\text{mcp}, \text{tip}) / \text{dist}(\text{mcp}, \text{pip}) < 1.25$.
  - **Thumb-to-MCP Abduction (`d4_9`, `d4_13`):** Separates `VICTORY` ($d_{4,9} \le 0.38$) from `THREE_FINGERS` (`three2`, $d_{4,9} \ge 0.91$) and `FIST` ($d_{4,9} \le 0.57$) from `THUMBS_UP` ($d_{4,9} \ge 0.98$) with zero $p_{10}\text{–}p_{90}$ overlap.
  - **Direction-Aware Prototype Boosting:** When applying online prototypes in `activeAdminModel.gesturePrototypes`, enforce vertical thumb polarity (`thDy >= -0.05 && wristDy >= 0.0` for `THUMBS_UP` vs. `THUMBS_DOWN`) so identical 5-finger flexion centroids never collide and collapse top-2 classification margin.

---

## ADR-003: Three Real-World Live Camera Failure Case Guards (`detectObjectGrasp`)
* **Root-Cause Failure Analysis:**
  1. **Case 1 (`Screenshot 2026-10-16 114707.png` — Smartphone in Hand $\rightarrow$ `POINTING_UP`):** Holding a smartphone vertically with the index finger extended along the top edge (`idx = 0.881`) while the thumb clamps the left edge and middle/ring/pinky hook around the right edge bypassed object-grasp guards that required `fourMax < 0.62`.
  2. **Case 2 (`Screenshot 2026-10-16 114648.png` — Empty Side-Profile Hand $\rightarrow$ `PALM_OCCLUDED_BY_OBJECT`):** Viewing a free, open hand in 3D radial profile aligns the 4 MCP joints (`5, 9, 13, 17`) along the optical axis (`aspect = 4.79 > 3.6`), falsely triggering Guard 1 (`PALM_OCCLUDED_BY_OBJECT`) despite all 4 fingers being unoccluded and extended (`fourMin = 0.829`, `palmLen = 0.299`).
  3. **Case 3 (`Screenshot 2026-10-16 121013.png` — Nose Tingling / Face Scratching $\rightarrow$ `FIST`):** Touching/scratching the nose places the index and middle MCP knuckles (`5, 9`) at the nose bridge with an acute MCP fold (`mIdx = 8.8°`, `mMid = 13.3°` $< 45^\circ$) while straight PIP segments (`177.6°`, `165.2°`) hang downward toward the wrist, producing low radial reach (`fourMean = 0.058`) that Rule 7 misclassified as `FIST`.
* **Biomechanical & Vision Invariants:**
  1. **Guard 6 (`WIDE_PHONE_OR_OBJECT_CLASP`):** Block whenever thumb tip (`4`) opposes the index/middle/ring knuckle line across a wide object body (`idx >= 0.50 && Math.max(mid, rng, pnk) < 0.45 && d4_5 > 0.72 && d4_10 > 1.10 && d4_14 > 1.10`). Across all $1,263$ real HaGRID `POINTING_UP` samples, $\max(d_{4,5}) = 0.55$.
  2. **Side-Profile Free-Hand Exemption (`isNaturalSideProfileFreeHand`):** Exempt natural 3D radial side-profile hands (`3.6 < aspect <= 6.2 && palmLen >= 0.22 && fourMin >= 0.70 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.28`) from Guard 1 and Guard 3 so they classify cleanly as `OPEN_PALM`.
  3. **Guard 7 (`CASUAL_FACE_TOUCH_OR_SCRATCH`) + Face/Nose ROI Overlap Guard:** Reject postures with acute MCP fold and straight downward-hanging PIP segments (`thumb < 0.48 && d4_9 < 0.68 && Math.min(mIdx, mMid) < 45 && Math.max(sIdx, sMid) > 0.65 && fourMean < 0.35`) OR live camera YCbCr skin-cluster overlap above elevated knuckles (`SceneAnalyzer.detectFaceNoseOverlap`).

---

## ADR-004: 60 Hz Render Loop vs. 30 Hz Webcam Synchronization & Immediate Voter Flush
* **Root Cause:** Browser `requestAnimationFrame` runs at $60\text{ Hz}$ while webcams update `video.currentTime` at $30\text{ Hz}$. Leaving `normLandmarks = null` on intermediate ticks where `video.currentTime === r.lastVideoTime` caused `intentRef.current.noHand()` and `voterRef.current.push("UNKNOWN")` to execute on every alternate frame. Additionally, `GestureVoter` hysteresis (`releaseRatio = 0.35`) allowed a prior gesture to remain committed for up to 5 frames after an object grasp began.
* **Signal Invariant:** Cache `r.lastLandmarks` across intermediate $60\text{ Hz}$ ticks (`now - r.lastHandTs < 150 ms`) and immediately call `voterRef.current.reset()` whenever `classification.objectGraspAnalysis?.isObjectGrasp === true`.

---

## ADR-005: Progressive 3-Stage Tremor Frequency ($f_0$) Personalizer & Spectral Notch Filter
* **Signal Invariant:**
  1. **Stage 1 (`INITIALIZED_60S_CALIB`):** Initialize $f_0$ from the user's 60-second enrolment baseline and hold fixed for `fixedHoldWindows = 4`.
  2. **Stage 2 (`OBSERVING_CONFIRMATION`):** Extract sliding-window DFT spectrum across $0.8\text{–}15.0\text{ Hz}$. Reject non-human/erratic bursts whenever $\text{totalEnergy} > 0.012 \land (\text{IFR} > 0.52 \lor \text{SCR} < 0.25)$.
  3. **Stage 3 (`FINALIZED_LOCKED`):** Lock $f_0$ once $\ge 8$ valid physiological windows ($3.0\text{–}12.0\text{ Hz}$) converge with $\sigma_{f_0} \le 0.48\text{ Hz}$, applying $92\%$ digital band-stop attenuation (`attenuationFactor = 0.08`) inside $f_0 \pm 1.0\text{ Hz}$ and $1.6\times$ penalty above $12.0\text{ Hz}$.

---

## ADR-006: Atomic File Persistence & Privacy-By-Default Pixel Stripping
* **Invariant:** Never persist raw camera pixel arrays (`raw_video_pixels_masked: true`). Persist Admin AI Trainer models (`storage/admin_trained_model.json`) and sample ledgers (`storage/admin_training_samples.json`) via POSIX atomic write-then-rename (`atomicWriteJsonSync`: write to `.tmp.<pid>.<ts>.<rand>` then `fs.renameSync`) to prevent partial-write corruption under concurrent requests.
