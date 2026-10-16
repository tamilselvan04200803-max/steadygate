# Domain Lead M2 Audit — Biomechanics, Kinematics & Cultural Semiotics (`S1`–`S5`)

- **Verdict**: `APPROVED`
- **Subagents Audited**: `S1`, `S2`, `S3`, `S4`, `S5`

## Verified Invariants
1. **3D Palm Surface Normal (`S1` — `src/lib/biomechanics/palm-orientation.ts`)**:
   - Computes $\vec{n} = (\vec{L}_5 - \vec{L}_0) \times (\vec{L}_{17} - \vec{L}_0)$ normalized by $\text{palmLen}^2$, inverting `normalZ` when `handedness === "Left"`.
   - Verified `isPalmar` (`normalZ < -0.002`) vs. `isDorsal` (`normalZ > 0.002`) and preserved `isNaturalSideProfileFreeHand` (`aspect in (3.6, 6.2]`, `palmLen >= 0.22`, `fourMin >= 0.70`, `|x_9 - x_0|/palmLen >= 0.28`).
2. **ISO-3166 Cultural Gesture Packs (`S2` — `src/lib/locales/gesture-packs.ts`)**:
   - Verified `THUMBS_UP` taboo restriction & safe remapping (`POINTING_UP`) in `IR`, `IQ`, `AF`, `NG`, `GR`.
   - Verified `PINCH` taboo restriction & safe remapping (`THREE_FINGERS`) in `BR`, `DE`, `TR`.
   - Verified dorsal `VICTORY` (`isPalmar === false`) suppression in `GB`, `IE`, `AU`, `NZ` while preserving palmar `VICTORY`.
   - Verified palmar `OPEN_PALM` (*Moutza*) remapping to `FOUR_FINGERS` in `GR` while preserving dorsal `OPEN_PALM`.
3. **Contracture ROM & Bed-Incline Gravity Normalization (`S3` — `src/lib/biomechanics/rom-gravity-normalizer.ts`)**:
   - Verified per-finger ROM denominator floor `Math.max(0.25, maxV - minV)` and torso gravity vector rotation `projectOntoTorsoGravity(vecX, vecY, bedTiltDeg)` across $[-60^\circ, +60^\circ]$.
4. **Levodopa $1\text{--}3\text{ Hz}$ Dyskinesia Decoupling (`S4` — `src/lib/signal-processing.ts`)**:
   - Verified `computeIntrinsicPostureStability(flexionHistory)` and $88\%$ attenuation of the $0.8\text{--}3.2\text{ Hz}$ ON-state dyskinesia band when `intrinsicStability >= 0.82` (`dyskinesiaCompensated: true`), while preserving all 70 assertions in `tests/adversarial-challenger-2.test.ts`.
5. **Caregiver Hand Biometric Rejector (`S5` — `src/lib/hand-gesture-engine.ts`)**:
   - Verified `computeBoneRatioSignature` and `verifyUserHandBiometrics` rejecting single-frame wrist jumps $> 0.25$ with $> 18\%$ anatomical bone-ratio deviation as `CAREGIVER_OR_BYSTANDER_HAND_IGNORED`, while preserving `97.40%` (`487/500`) HaGRID accuracy and `0/200` (`0.0%`) object-grasp false positives.
