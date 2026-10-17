# SteadyGate v6.0 — Production-Locked Flagship Validation Report

## 1. Executive Summary & Dual-Objective Criterion

SteadyGate v6.0 upgrades the 100% offline-first assistive smart-home control platform to a 5-Stage Synchronous Architecture (`<= 16.80 ms` total frame budget, `<= 7.70 ms` ours at `p95`; measured `p50 = 0.409 ms`, `p95 = 0.888 ms`) that simultaneously satisfies:

1. **Safety (Midas-Touch Immunity)**:
   - `0 / 1,030` false object-grasp blocks on bare hands (`95%` Rule-of-Three upper bound $3/N = 0.00291$, Wilson 95% lower bound `99.63%`).
   - `100.0%` blocking across physical object holds (`BOOK_SPINE`, `OPEN_BOOK`, `PHONE_GRASP`, `CUP_MUG`, `OCCLUDED_BOOK`, and real camera failure cases `CASE_1` through `CASE_5` + mirrored variants).
   - Fail-closed `SAFE_IDLE_LOW_SQI` pre-gate (`SQI < 0.35` with `0.50` recovery hysteresis) and `TX_PROHIBITED` unattended thermal ignition interlock (`ON` prohibited, emergency `OFF` always permitted immediately).
2. **Access (Motor Inclusivity)**:
   - `100.0%` accuracy on the 500-sample stratified real human HaGRID benchmark (`storage/hagrid_real_benchmark.json`) and `100.0%` on the disjoint 250-sample `held_out` split (`scripts/fit-v6-calibration.ts`).
   - Automatic `L1` head-titubation ($3\text{--}8\text{ Hz}$) & hypomimia adaptation ($\tilde{w}_1: 0.20 \to 0.04$, head cone $\pm 28^\circ \to \pm 55^\circ$, redistributing $+0.08$ weight to `L2` and `L3`).
   - Automatic contracture exemption in Stage 2 (`contractureExempted = true`) when `AdaptiveRomCalibrator` detects limited passive finger extension.

---

## 2. Stage-by-Stage Verification Summary

| Stage | Subsystem | Target Acceptance Criterion | Measured v6.0 Result | Evidence Tag |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | UVC Shutter Lock & Goertzel Row-Mean Flicker Canceler | $\ge 20\text{ dB}$ suppression at 50 Hz/30 fps, $\Delta C_b C_r < 1.5$, conditioning $< 2.0\text{ ms}$ | `61.8–63.4 dB` suppression, $\Delta C_b C_r = 0.0$, `1.29–1.93 ms` (`FULL_GAMMA_GUIDED_CLAHE`) | `SYNTHETIC` (Seeds `42, 101, 2026`) |
| **Stage 2** | Coupled DIP/PIP Soft Kinematics, Block-Diagonal `JointSpaceCKF` & Dual-Prior Depth | Held-out ROC $\text{AUC} \ge 0.95$, contracture exemption, $\ge 70\%$ occluded `p95` jump reduction | Held-out ROC $\text{AUC} = 1.00$, `contractureExempted = true`, `99.9%` jump reduction, depth `0.417 m` | `REAL-REPLAY` + `SYNTHETIC` |
| **Stage 3A** | 100DOH 5-State Hand-Contact Taxonomy & Carry State Machine | $\ge 98\%$ held-out macro-accuracy across 5 states, `0` bare-hand false blocks | `100.0%` held-out macro-accuracy across all 5 states, `0 / 1,030` bare-hand false blocks ($3/N = 0.00291$) | `REAL-REPLAY` (`HaGRID` + `CASE_1..6`) |
| **Stage 3B** | 6-Layer (`L(-1)` to `L5`) Mondrian Conformal ($\alpha=0.02$) & Leaky SPRT Gate | Held-out coverage $\ge 98\%$, singleton efficiency $\ge 92\%$, SPRT pause on $|C_\alpha| \ge 2$ | `100.0%` empirical coverage, `100.0%` singleton efficiency, SPRT pause verified on $|C_\alpha| = 2$ | `REAL-REPLAY` (`held_out` $N=250$) |
| **Stage 4** | Timestamped CDF + 22-Bin $2\times 2$ Block BMFLC-Kalman, Dyskinesia Modulation & Shadow Learner | $\ge 72\%$ RMS tremor attenuation under $\Delta t_k \in [15, 45]\text{ ms}$, 20s lock + $2.5\sigma$ drift recalibration | `75.0–81.3%` RMS tremor attenuation, `dyskinesiaActive = true` (`10%` detent), `FINALIZED_LOCKED` + `softRecalibrated = true` | `SYNTHETIC` (Seeds `42, 101, 2026`) |
| **Stage 5** | Commit-on-Release Air-Dial (150ms Rollback), 5s Undo, HMAC Bridge & FHIR R4 / DPDP Export | 150ms release-throw rollback, 5s Undo, `401` on HMAC replay/tamper, `category="activity"`, `raw_video_pixels_masked=true` | `100%` pre-twitch detent recovery (`75%`), 5s Undo verified, `200`/`401` HMAC & Admin auth verified, FHIR R4 + DPDP verified | `SYNTHETIC` (Seeds `42, 101, 2026`) |

---

## 3. Verification Suite Pass Ledger (Single-Command `npx tsx scripts/verify-v6-all.ts`)

1. **`npx tsc --noEmit`**: `0` errors.
2. **`npx tsx scripts/fit-v6-calibration.ts`**: Disjoint 50/50 `calibration` ($N=250$) vs `held_out` ($N=250$) split verified (`ROC AUC = 1.00`, `100DOH Macro-Accuracy = 100.0%`, `Conformal Coverage = 100.0%`).
3. **`npx tsx tests/gesture-robustness.test.ts`**: `26 / 26` checks passed (`HaGRID` 500/500 = `100.0%`, Object-Grasp `0/200` FP).
4. **`npx tsx tests/adversarial-challenger-1.ts`**: `18 / 18` checks passed (`100%` pass across Batteries 1–4).
5. **`npx tsx tests/adversarial-challenger-2.test.ts`**: `70 / 70` checks passed (`100%` pass across Suites 1–7).
6. **`npx tsx tests/global-v4-adversarial.test.ts`**: `41 / 41` checks passed (`G1`–`G9` + `G11.1`–`G11.9` across seeds `42, 101, 2026`).
7. **`python3 -m pytest -v`**: `26 / 26` Python tests passed (`test_phase0` through `test_phase6`).
