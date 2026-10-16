# SteadyGate — Tremor-Compensated Hand-Gesture Smart-Home Controller

SteadyGate is a local-first, vision-based assistive smart-home control system built in Next.js and TypeScript for users with motor impairments (Parkinsonian resting tremor and Essential Tremor, $3.0\text{–}12.0\text{ Hz}$). It combines MediaPipe 21-point hand landmarking, adaptive canvas pre-processing, a 7-stage biomechanical object-grasp & self-touch guard, and a 3-stage spectral tremor frequency ($f_0$) personalizer.

---

## Architecture Overview (Unified TypeScript Runtime)

All core perception, signal processing, intent gating, and appliance actuation run in a single unified Next.js + TypeScript runtime with **zero external cloud dependencies**:

| Module | File Path | Core Responsibility |
| :--- | :--- | :--- |
| **1. Biomechanical Gesture & Grasp Engine** | `src/lib/hand-gesture-engine.ts` | Scale- and foreshortening-invariant 21-landmark feature extraction (`extractHandParameters`), 7-tier object-grasp & facial self-touch rejection (`detectObjectGrasp`), and 10-class gesture classification calibrated on $N = 17,213$ real human HaGRID samples (`classifyHandGesture`). |
| **2. Real-Time Vision & CLAHE Pre-Processing** | `src/lib/vision-runtime.ts`, `src/components/LiveCameraStream.tsx` | $64 \times 48$ luminance/contrast/clutter analysis, adaptive $\gamma$ + CLAHE contrast stretching (`SceneAnalyzer`), YCbCr upper-central Face/Nose ROI overlap detection (`detectFaceNoseOverlap`), One-Euro landmark smoothing (`LandmarkSmoother`), 9-frame hysteresis voting (`GestureVoter`), and 60 Hz/30 Hz frame synchronization. |
| **3. Spectral Tremor $f_0$ Personalizer** | `src/lib/signal-processing.ts` | Sliding-window DFT ($0.8\text{–}15.0\text{ Hz}$), Spectral Concentration Ratio ($\text{SCR}$), Irregular Frequency Ratio ($\text{IFR}$), 3-stage $f_0$ lock (`INITIALIZED_60S_CALIB` $\rightarrow$ `OBSERVING_CONFIRMATION` $\rightarrow$ `FINALIZED_LOCKED`), and $92\%$ digital band-stop notch attenuation (`calculateNormalizedStability`). |
| **4. Admin AI Trainer & Atomic Persistence** | `src/app/api/admin-train/route.ts`, `src/components/AdminGestureTrainer.tsx`, `src/db/index.ts` | Live ground-truth gesture & negative object-grasp capture (`BOOK_HOLD_NEGATIVE`), CSV/JSON dataset ingestion, online prototype adaptation ($\alpha = 0.22$), POSIX atomic write-then-rename (`atomicWriteJsonSync`), and PGlite/PostgreSQL persistence. |

*(Note: The `steadygate/` Python directory is an optional offline simulation and hardware-relay evaluation suite and is not required to run the unified Next.js web application.)*

---

## Root-Cause Failure Analysis $\rightarrow$ Biomechanical & Signal Invariants

### 1. Smartphone / Wide-Object Clasp with Extended Index Finger (`Screenshot 114707.png`)
* **Root Cause:** Holding a smartphone vertically with the back facing the camera places the index finger extended along the top edge (`idx = 0.881`) while the thumb clamps the left edge (`landmarks[4]`) and the middle, ring, and pinky fingers hook around the right edge (`mid = 0.003, rng = 0.009, pnk = 0.008`). Prior object-grasp guards gated on `fourMax < 0.62`, allowing `idx = 0.881` to bypass grasp rejection and misclassify as `POINTING_UP` (`0.95` confidence).
* **Biomechanical Invariant (`WIDE_PHONE_OR_OBJECT_CLASP`):** Across all $N = 1,263$ real human `POINTING_UP` (`one`) samples in HaGRID, the thumb is anatomically attached to the radial palm and tucked near the index/middle MCPs (`max(d4_5) = 0.55`, `p95(d4_10) = 0.56`, `p95(d4_14) = 0.46`). Clamping a wide phone or book between the thumb and opposite-edge knuckles forces `d4_5 = 1.02`, `d4_10 = 1.62`, and `d4_14 = 1.75`. Guard 6 blocks any frame satisfying:
  $$\text{idx} \ge 0.50 \;\land\; \max(\text{mid}, \text{rng}, \text{pnk}) < 0.45 \;\land\; d_{4,5} > 0.72 \;\land\; d_{4,10} > 1.10 \;\land\; d_{4,14} > 1.10$$

### 2. Empty Free Hand in 3D Radial Side Profile (`Screenshot 114648.png`)
* **Root Cause:** Viewing an empty, open hand edge-on from the radial/thumb side aligns the 4 MCP knuckles (`5, 9, 13, 17`) along the optical axis (`palmWidth = 0.062`), raising the 2D aspect ratio `palmLen / palmWidth` to `4.79 > 3.6` and falsely triggering Guard 1 (`PALM_OCCLUDED_BY_OBJECT`).
* **Biomechanical Invariant (`isNaturalSideProfileFreeHand`):** Unlike an object-occluded palm (where `palmLen` collapses or fingers are semi-curled), a natural 3D radial side-profile open hand preserves full unoccluded palm length (`palmLen >= 0.22`), full 4-finger extension (`fourMin >= 0.70`), and a natural dorsal wrist-to-MCP horizontal offset (`|x_9 - x_0| / palmLen >= 0.28`):
  $$\text{isNaturalSideProfileFreeHand} \iff 3.6 < \text{aspect} \le 6.2 \;\land\; L_{\text{palm}} \ge 0.22 \;\land\; \min_{i \in \{5,9,13,17\}} e_i \ge 0.70 \;\land\; \frac{|x_9 - x_0|}{L_{\text{palm}}} \ge 0.28$$

### 3. Nose Tingling / Casual Facial Self-Touch (`Screenshot 121013.png`)
* **Root Cause:** Raising the hand to touch or scratch the nose places the index and middle MCP knuckles (`5, 9`) near the bridge of the nose with the fingers draping downward toward the wrist (`y_tip > y_pip > y_mcp`). Because radial wrist-to-tip reach is low (`fourMean = 0.058 < 0.32`), Rule 7 previously misclassified the posture as `FIST` (`0.92` confidence).
* **Dual Biomechanical + Face ROI Invariant (`CASUAL_FACE_TOUCH_OR_SCRATCH`):**
  1. **Biomechanical Dorsal/Scratch Guard:** In $100\%$ of real HaGRID `FIST` samples ($N = 945$), PIP joints are tightly flexed ($p_{50} = 13.7^\circ$, $p_{90} = 27.1^\circ$, $\max = 64.0^\circ$) and MCP angles are $\ge 109.9^\circ$. In nose/face scratching (`Screenshot 121013.png`), the MCP joints fold acutely back toward the wrist (`mIdx = 8.8°`, `mMid = 13.3°` $< 45^\circ$) while the downward-hanging PIP segments remain nearly straight (`177.6°` and `165.2°`, `max(sIdx, sMid) > 0.65`).
  2. **Live Face/Nose ROI Overlap Guard (`SceneAnalyzer.detectFaceNoseOverlap`):** Evaluates YCbCr skin chrominance ($R > 60, C_r \in [132, 178], C_b \in [75, 132]$) directly above elevated knuckles when fingers hang downward (`y_tip > y_mcp + 0.04 * palmLen`), immediately forcing `UNKNOWN` and flushing the 9-frame `GestureVoter`.

### 4. 60 Hz Render Loop vs. 30 Hz Webcam Frame Synchronization (`LiveCameraStream.tsx`)
* **Root Cause:** Browser `requestAnimationFrame` executes at $60\text{ Hz}$ (`16.67 ms`) while webcams deliver frames at $30\text{ Hz}$ (`33.33 ms`). On intermediate animation ticks where `video.currentTime === r.lastVideoTime`, leaving `normLandmarks = null` caused `intentRef.current.noHand()` and `voterRef.current.push("UNKNOWN")` to execute on $50\%$ of frames.
* **Signal Invariant:** Cache `r.lastLandmarks` across intermediate $60\text{ Hz}$ ticks (`now - r.lastHandTs < 150 ms`) and flush `voterRef.current.reset()` immediately whenever `isObjectGrasp === true`.

---

## Verification Matrix

| Verification Suite | Command | Sample Population & Seed | Measured Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Core Gesture & 3 Live Screenshot Cases** | `npx tsx tests/gesture-robustness.test.ts` | `26` checks (`seed=42`, $n=500$ HaGRID, $n=200$ grasps, $n=3$ live screenshots) | **26 / 26 Passed** (`97.40%` HaGRID 500, `98.29%` HaGRID 17k, `0.0%` Grasp FP) | **PASS** |
| **Challenger 1: Object-Grasp, CLAHE & 3 Cases** | `npx tsx tests/adversarial-challenger-1.ts` | `18` batteries ($n = 2,110$ frames across grasps, lighting extremes, & 3 screenshot cases) | **18 / 18 Passed** (`0/200` Grasp FP, `0/1310` Valid Gesture False Rejections, `0/120` Screenshot Errors) | **PASS** |
| **Challenger 2: Tremor $f_0$ & Admin Trainer Concurrency** | `npx tsx tests/adversarial-challenger-2.test.ts` | `70` assertions ($3\text{–}45\text{ Hz}$ sweeps, white noise, 10x concurrent atomic writes) | **70 / 70 Passed** (`92%` notch attenuation, `0` race corruptions) | **PASS** |
| **TypeScript Strict Compilation** | `npm run typecheck` | Full Next.js + TypeScript codebase (`src/`, `tests/`) | **0 Errors** | **PASS** |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the unified Next.js application (PGlite zero-config embedded DB or PostgreSQL)
npm run dev

# 3. Run the verification suites
npx tsx tests/gesture-robustness.test.ts
npx tsx tests/adversarial-challenger-1.ts
npx tsx tests/adversarial-challenger-2.test.ts
npm run typecheck
```
