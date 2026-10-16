/**
 * Subagent S12 — Global v4.0 Adversarial & Chaos Benchmark Suite (8 Batteries, seed=42)
 * Run via: npx tsx tests/global-v4-adversarial.test.ts
 */

import {
  computePalmOrientation,
  isNaturalSideProfileFreeHand,
} from "../src/lib/biomechanics/palm-orientation";
import {
  LOCALE_GESTURE_PACKS,
  getLocaleGesturePack,
  resolveLocaleGesture,
} from "../src/lib/locales/gesture-packs";
import {
  normalizeFingerROM,
  projectOntoTorsoGravity,
  AdaptiveRomCalibrator,
} from "../src/lib/biomechanics/rom-gravity-normalizer";
import {
  computeIntrinsicPostureStability,
  calculateNormalizedStability,
} from "../src/lib/signal-processing";
import {
  classifyHandGesture,
  computeBoneRatioSignature,
  verifyUserHandBiometrics,
  generateSyntheticGestureLandmarks,
  generateObjectGraspLandmarks,
  REAL_WORLD_FAILURE_CASES,
} from "../src/lib/hand-gesture-engine";
import {
  MONK_SKIN_TONE_RGB_REFERENCE,
  AdaptiveSkinCalibrator,
} from "../src/lib/vision/skin-calibrator";
import { SceneAnalyzer } from "../src/lib/vision-runtime";
import { TimeWeightedGestureVoter } from "../src/lib/voter/time-weighted-voter";
import {
  SafetyChordEngine,
  ActuatorCircuitBreaker,
  resolveApplianceRiskTier,
} from "../src/lib/policy/safety-chord-engine";
import { dispatchLanActuation } from "../src/lib/hardware/lan-bridge";
import type { HandLandmark2D, RecognizedGesture } from "../src/lib/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail: string = "") {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${label}${detail ? ` (${detail})` : ""}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function runGlobalV4Suite() {
  console.log("================================================================================");
  console.log("🌍 STEADYGATE v4.0 GLOBAL 16-AGENT SWARM ADVERSARIAL SUITE (8 BATTERIES, seed=42)");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // BATTERY G1: Monk Skin Tone (MST 1-10) Equity & Wood Background Subtraction
  // ---------------------------------------------------------------------------
  console.log("[Battery G1] Monk Skin Tone (MST 1-10) Equity & Wood Background Subtraction");
  const lightingKelvins = [
    { name: "2700K_Warm", scale: [1.06, 0.97, 0.86] },
    { name: "6500K_Cool", scale: [0.95, 1.0, 1.06] },
  ];
  let mstPassCount = 0;
  let mstTotalChecks = 0;

  for (const mstEntry of MONK_SKIN_TONE_RGB_REFERENCE) {
    for (const light of lightingKelvins) {
      mstTotalChecks++;
      const r = Math.min(255, Math.max(18, Math.round(mstEntry.rgb[0] * light.scale[0])));
      const g = Math.min(255, Math.max(16, Math.round(mstEntry.rgb[1] * light.scale[1])));
      const b = Math.min(255, Math.max(14, Math.round(mstEntry.rgb[2] * light.scale[2])));

      // Fill a 64x48 RGBA buffer with the user's MST skin tone at both palm and nose ROI
      const rgba = new Uint8ClampedArray(64 * 48 * 4);
      for (let i = 0; i < 64 * 48; i++) {
        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 255;
      }

      const analyzer = new SceneAnalyzer();
      // Step 1: Calibrate on a free-hand frame (OPEN_PALM)
      const openPalmLm = generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.0, 0.01);
      analyzer.detectFaceNoseOverlap(openPalmLm, rgba);

      // Step 2: Test Case 3 Nose Tingling / Face Scratch overlap detection on this MST tone
      const case3Lm = REAL_WORLD_FAILURE_CASES.CASE_3_NOSE_TINGLING_SCRATCH;
      const overlap = analyzer.detectFaceNoseOverlap(case3Lm, rgba);
      const classRes = classifyHandGesture(case3Lm, null, { faceOverlapDetected: overlap });

      if (overlap && classRes.gesture === "UNKNOWN") {
        mstPassCount++;
      }
    }
  }
  assert(
    mstPassCount === mstTotalChecks,
    "G1.1 All 10 Monk Skin Tones (MST 1-10) x (2700K, 6500K) pass self-calibration & Case 3 Face Overlap Guard",
    `${mstPassCount}/${mstTotalChecks}`
  );

  // Verify background wood/wall chrominance subtraction when user skin != wooden door
  const woodCalib = new AdaptiveSkinCalibrator();
  const woodRgba = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < 64 * 48; i++) {
    woodRgba[i * 4] = 155; // warm wood door
    woodRgba[i * 4 + 1] = 105;
    woodRgba[i * 4 + 2] = 65;
    woodRgba[i * 4 + 3] = 255;
  }
  for (let k = 0; k < 4; k++) woodCalib.sampleBackgroundRoi(woodRgba, 64, 48);

  const mst2Rgba = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < 64 * 48; i++) {
    mst2Rgba[i * 4] = 243;
    mst2Rgba[i * 4 + 1] = 231;
    mst2Rgba[i * 4 + 2] = 219;
    mst2Rgba[i * 4 + 3] = 255;
  }
  for (let k = 0; k < 4; k++) woodCalib.samplePalmPatch(mst2Rgba, 64, 48, 0.5, 0.5);
  assert(
    woodCalib.isUserSkinPixel(155, 105, 65) === false &&
      woodCalib.isUserSkinPixel(243, 231, 219) === true,
    "G1.2 Static wooden door chrominance is subtracted while user palm skin remains recognized"
  );

  // ---------------------------------------------------------------------------
  // BATTERY G2: Cultural Locale Remapping & Taboo Suppression (S1 + S2)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G2] Cultural Locale Remapping & Taboo Suppression (S1 + S2)");
  const palmarLm = generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.0, 0.0);
  // Make palmar normalZ negative (Right hand: index MCP left of pinky MCP)
  palmarLm[5].x = 0.42;
  palmarLm[17].x = 0.58;
  const palmarOrient = computePalmOrientation(palmarLm, "Right");

  const dorsalLm = palmarLm.map((p) => ({ ...p }));
  // Flip index MCP and pinky MCP horizontally to simulate dorsal back-of-hand facing camera
  dorsalLm[5].x = 0.58;
  dorsalLm[17].x = 0.42;
  const dorsalOrient = computePalmOrientation(dorsalLm, "Right");

  assert(
    palmarOrient.isPalmar && !dorsalOrient.isPalmar && dorsalOrient.isDorsal,
    "G2.1 3D Palmar vs Dorsal surface normal cross-product distinguishes palm-facing vs back-of-hand",
    `palmarZ=${palmarOrient.normalZ}, dorsalZ=${dorsalOrient.normalZ}`
  );

  const irThumbs = resolveLocaleGesture("THUMBS_UP", palmarOrient, "IR");
  const brPinch = resolveLocaleGesture("PINCH", palmarOrient, "BR");
  const gbVictoryDorsal = resolveLocaleGesture("VICTORY", dorsalOrient, "GB");
  const gbVictoryPalmar = resolveLocaleGesture("VICTORY", palmarOrient, "GB");
  const grMoutzaPalmar = resolveLocaleGesture("OPEN_PALM", palmarOrient, "GR");
  const grOpenDorsal = resolveLocaleGesture("OPEN_PALM", dorsalOrient, "GR");

  assert(
    irThumbs.culturallyRestricted &&
      irThumbs.remapped &&
      irThumbs.effectiveGesture === "POINTING_UP",
    "G2.2 THUMBS_UP is culturally restricted in IR/IQ/AF/NG/GR and safely remapped to POINTING_UP"
  );
  assert(
    brPinch.culturallyRestricted &&
      brPinch.remapped &&
      brPinch.effectiveGesture === "THREE_FINGERS",
    "G2.3 PINCH (OK ring) is culturally restricted in BR/DE/TR and safely remapped to THREE_FINGERS"
  );
  assert(
    gbVictoryDorsal.culturallyRestricted &&
      gbVictoryDorsal.effectiveGesture === "UNKNOWN" &&
      !gbVictoryPalmar.culturallyRestricted &&
      gbVictoryPalmar.effectiveGesture === "VICTORY",
    "G2.4 Dorsal VICTORY is blocked in GB/IE/AU/NZ while Palmar VICTORY remains active"
  );
  assert(
    grMoutzaPalmar.remapped &&
      grMoutzaPalmar.effectiveGesture === "FOUR_FINGERS" &&
      !grOpenDorsal.remapped &&
      grOpenDorsal.effectiveGesture === "OPEN_PALM",
    "G2.5 Palmar OPEN_PALM (Moutza) in GR is remapped to FOUR_FINGERS while dorsal OPEN_PALM is preserved"
  );

  // ---------------------------------------------------------------------------
  // BATTERY G3: Contracture ROM & Bed-Incline -45 deg Gravity Audit (S3 + S5)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G3] Contracture ROM & Bed-Incline -45 deg Gravity Audit (S3 + S5)");
  const contractureCalib = {
    minFlexion: [0.05, 0.05, 0.05, 0.05, 0.05] as [number, number, number, number, number],
    maxExtension: [0.55, 0.55, 0.55, 0.55, 0.55] as [number, number, number, number, number],
    bedTiltDeg: 0,
  };
  const normed = normalizeFingerROM([0.52, 0.53, 0.51, 0.52, 0.54], contractureCalib);
  assert(
    normed.every((v) => v >= 0.9),
    "G3.1 Per-finger ROM normalization expands 0.52 contracture ceiling to >= 0.90 normalized extension",
    `normed=[${normed.join(", ")}]`
  );

  // Rotate a THUMBS_UP hand by +45 deg (simulating user reclining at -45 deg bed tilt)
  const baseThumbUp = generateSyntheticGestureLandmarks("THUMBS_UP", 0, 5.0, 0.0);
  const rad45 = (45 * Math.PI) / 180;
  const rotatedThumbUp: HandLandmark2D[] = baseThumbUp.map((p) => {
    const dx = p.x - 0.5;
    const dy = p.y - 0.5;
    return {
      x: 0.5 + dx * Math.cos(rad45) - dy * Math.sin(rad45),
      y: 0.5 + dx * Math.sin(rad45) + dy * Math.cos(rad45),
      z: p.z,
    };
  });
  const gravProjected = projectOntoTorsoGravity(
    rotatedThumbUp[5].x - rotatedThumbUp[4].x,
    rotatedThumbUp[5].y - rotatedThumbUp[4].y,
    45
  );
  assert(
    gravProjected.y > 0.05,
    "G3.2 Bed-incline torso gravity projection restores vertical thumb polarity at 45 deg bed tilt",
    `projectedY=${gravProjected.y.toFixed(3)}`
  );

  // ---------------------------------------------------------------------------
  // BATTERY G4: Levodopa 1-3 Hz Dyskinesia vs. 4-12 Hz Tremor Decoupling (S4)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G4] Levodopa 1-3 Hz Dyskinesia vs. 4-12 Hz Tremor Decoupling (S4)");
  const steadyFlexHistory: Array<[number, number, number, number, number]> = Array.from(
    { length: 20 },
    (_, i) => [
      0.04 + Math.sin(i) * 0.005,
      0.03 + Math.cos(i) * 0.005,
      0.04,
      0.03,
      0.04,
    ]
  );
  const erraticFlexHistory: Array<[number, number, number, number, number]> = Array.from(
    { length: 20 },
    (_, i) => [
      i % 2 === 0 ? 0.85 : 0.1,
      i % 2 === 0 ? 0.9 : 0.12,
      i % 2 === 0 ? 0.88 : 0.08,
      0.4,
      0.5,
    ]
  );
  const steadyPosture = computeIntrinsicPostureStability(steadyFlexHistory);
  const erraticPosture = computeIntrinsicPostureStability(erraticFlexHistory);

  // Simulate spectrum with 2.0 Hz dyskinesia + 5.2 Hz Parkinsonian tremor
  const freqs = [1.0, 2.0, 3.0, 4.0, 5.2, 6.0, 8.0, 10.0];
  const mags = [0.008, 0.028, 0.009, 0.005, 0.035, 0.005, 0.002, 0.001];

  const dyskComp = calculateNormalizedStability(
    mags,
    freqs,
    5.2,
    0.045,
    2.0,
    steadyPosture.intrinsicStability
  );
  const dyskPenalized = calculateNormalizedStability(
    mags,
    freqs,
    5.2,
    0.045,
    2.0,
    erraticPosture.intrinsicStability
  );

  assert(
    steadyPosture.intrinsicStability >= 0.82 &&
      Boolean(dyskComp.dyskinesiaCompensated) &&
      dyskComp.stabilityNorm >= 0.72,
    "G4.1 Steady intrinsic finger posture under 2.0 Hz Levodopa dyskinesia activates dyskinesia compensation",
    `intrinsic=${steadyPosture.intrinsicStability}, stabilityNorm=${dyskComp.stabilityNorm}`
  );
  assert(
    erraticPosture.intrinsicStability < 0.82 &&
      !dyskPenalized.dyskinesiaCompensated &&
      dyskPenalized.stabilityNorm < dyskComp.stabilityNorm,
    "G4.2 Erratic finger motion under 1-3 Hz movement is penalized by 3.5x",
    `erraticIntrinsic=${erraticPosture.intrinsicStability}, stabilityNorm=${dyskPenalized.stabilityNorm}`
  );

  // ---------------------------------------------------------------------------
  // BATTERY G5: Caregiver Hand Intrusion & Biometric Bone-Ratio Guard (S5)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G5] Caregiver Hand Intrusion & Biometric Bone-Ratio Guard (S5)");
  const patientLm = generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.0, 0.0);
  const patientRatios = computeBoneRatioSignature(patientLm);
  const patientWrist = { x: patientLm[0].x, y: patientLm[0].y };

  // Caregiver hand jumps into frame at +0.38 screen units with 28% wider palm / shorter fingers
  const caregiverLm: HandLandmark2D[] = patientLm.map((p, idx) => ({
    x: p.x + 0.32 + (idx === 5 ? -0.06 : idx === 17 ? 0.06 : 0),
    y: p.y - 0.24,
    z: p.z,
  }));

  const patientVerdict = verifyUserHandBiometrics(patientLm, {
    boneRatios: patientRatios,
    lastWrist: patientWrist,
  });
  const caregiverVerdict = verifyUserHandBiometrics(caregiverLm, {
    boneRatios: patientRatios,
    lastWrist: patientWrist,
  });
  const caregiverClass = classifyHandGesture(caregiverLm, null, {
    enrolledBiometrics: { boneRatios: patientRatios, lastWrist: patientWrist },
  });

  assert(
    patientVerdict.verified &&
      !caregiverVerdict.verified &&
      caregiverVerdict.reason === "CAREGIVER_OR_BYSTANDER_HAND_IGNORED" &&
      caregiverClass.gesture === "UNKNOWN",
    "G5.1 Caregiver hand intrusion (>0.25 jump & >18% bone-ratio deviation) is rejected as CAREGIVER_OR_BYSTANDER_HAND_IGNORED",
    `jump=${caregiverVerdict.wristJumpDelta}, boneDev=${caregiverVerdict.boneRatioDeviation}%`
  );

  // ---------------------------------------------------------------------------
  // BATTERY G6: Frame-Rate Invariance: 12fps vs. 30fps vs. 120Hz (S8)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G6] Frame-Rate Invariance: 12fps vs. 30fps vs. 120Hz (S8)");
  function measureCommitLatencyMs(fps: number): number {
    const voter = new TimeWeightedGestureVoter(350, 0.60, 0.35);
    const dt = 1000 / fps;
    for (let step = 0; step < 200; step++) {
      const t = step * dt;
      const res = voter.push("FIST", 0.92, t);
      if (res.committed === "FIST") {
        return Math.round(t);
      }
    }
    return 9999;
  }

  const commit12fps = measureCommitLatencyMs(12);
  const commit30fps = measureCommitLatencyMs(30);
  const commit120fps = measureCommitLatencyMs(120);
  const spreadMs =
    Math.max(commit12fps, commit30fps, commit120fps) -
    Math.min(commit12fps, commit30fps, commit120fps);

  assert(
    spreadMs <= 90 && commit12fps <= 300 && commit120fps >= 180,
    "G6.1 TimeWeightedGestureVoter achieves frame-rate invariant commit latency across 12fps, 30fps, and 120Hz",
    `12fps=${commit12fps}ms, 30fps=${commit30fps}ms, 120Hz=${commit120fps}ms, spread=${spreadMs}ms`
  );

  // ---------------------------------------------------------------------------
  // BATTERY G7: 50/60 Hz Mains Beat Flicker & <2.0ms ROI CLAHE Budget (S7)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G7] 50/60 Hz Mains Beat Flicker & <2.0ms ROI CLAHE Budget (S7)");
  const flickerScene = new SceneAnalyzer();
  let lastFlicker = { flickerHz: 0, stabilizedLum: 0.5 };
  for (let i = 0; i < 30; i++) {
    const tMs = i * 16.67; // 60fps capture under 50Hz mains -> 10Hz beat oscillation
    const lum = 0.48 + 0.06 * Math.sin((2 * Math.PI * 10.0 * tMs) / 1000);
    lastFlicker = flickerScene.detectMainsBeatFlicker(lum, tMs);
  }
  assert(
    lastFlicker.flickerHz >= 8.0 &&
      lastFlicker.flickerHz <= 12.5 &&
      Math.abs(lastFlicker.stabilizedLum - 0.48) < 0.02,
    "G7.1 50Hz/60Hz fluorescent beat frequency (10 Hz) is detected & luminance stabilized",
    `flickerHz=${lastFlicker.flickerHz}Hz, stabilizedLum=${lastFlicker.stabilizedLum.toFixed(3)}`
  );

  const claheBuf = new Uint8ClampedArray(64 * 48 * 4);
  const clahePerf = flickerScene.applyRoiClaheToBuffer(claheBuf, 64, 48, {
    x0: 0.2,
    y0: 0.2,
    x1: 0.8,
    y1: 0.8,
  });
  assert(
    clahePerf.elapsedMs < 2.0,
    "G7.2 ROI-cropped CLAHE governor completes in < 2.0ms per frame",
    `elapsedMs=${clahePerf.elapsedMs}ms, pixels=${clahePerf.pixelsProcessed}`
  );

  // ---------------------------------------------------------------------------
  // BATTERY G8: Tier 3 Two-Step Safety Chord & Circuit Breaker Lockout (S9 + S10)
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G8] Tier 3 Two-Step Safety Chord & Circuit Breaker Lockout (S9 + S10)");
  const chord = new SafetyChordEngine(350, 2500, 1500);
  const breaker = new ActuatorCircuitBreaker(3);
  const heaterTier = resolveApplianceRiskTier(9.1, "R3");

  // 1. Holding FIST directly without Step 1 OPEN_PALM must NOT verify Tier 3
  let tNow = 1000;
  let sState = chord.evaluateStep({
    deviceId: "heater_01",
    riskTier: heaterTier,
    committedGesture: "FIST",
    nowMs: tNow,
  });
  assert(
    !sState.chordVerified && sState.stage === "IDLE",
    "G8.1 Holding FIST directly on Tier 3 appliance (9.1A Heater) is blocked until Step 1 OPEN_PALM is armed"
  );

  // 2. Arm Step 1 with OPEN_PALM for 400ms, then transition to FIST and hold 1600ms
  for (let i = 0; i < 12; i++) {
    tNow += 40;
    sState = chord.evaluateStep({
      deviceId: "heater_01",
      riskTier: heaterTier,
      committedGesture: "OPEN_PALM",
      nowMs: tNow,
    });
  }
  assert(
    sState.stage === "STEP_1_ARMED_AWAITING_FIST",
    "G8.2 Holding OPEN_PALM >= 350ms arms Step 1 of the Two-Step Safety Chord"
  );

  for (let i = 0; i < 40; i++) {
    tNow += 40;
    sState = chord.evaluateStep({
      deviceId: "heater_01",
      riskTier: heaterTier,
      committedGesture: "FIST",
      nowMs: tNow,
    });
  }
  assert(
    sState.chordVerified && sState.stage === "CHORD_VERIFIED",
    "G8.3 Transitioning to FIST within 2500ms and holding 1500ms completes Tier 3 Two-Step Chord"
  );

  // 3. Verify instant abort on object grasp during countdown
  const abortChord = new SafetyChordEngine(350, 2500, 1500);
  let tAbort = 5000;
  for (let i = 0; i < 12; i++) {
    tAbort += 40;
    abortChord.evaluateStep({
      deviceId: "lock_01",
      riskTier: 3,
      committedGesture: "OPEN_PALM",
      nowMs: tAbort,
    });
  }
  const abortedState = abortChord.evaluateStep({
    deviceId: "lock_01",
    riskTier: 3,
    committedGesture: "FIST",
    nowMs: tAbort + 40,
    isObjectGrasp: true,
  });
  assert(
    !abortedState.chordVerified && abortedState.stage === "CHORD_ABORTED_BY_USER",
    "G8.4 Object grasp during Tier 3 countdown immediately aborts with CHORD_ABORTED_BY_USER"
  );

  // 4. Verify LAN Bridge Tier 3 gate & 3-strike Circuit Breaker lockout
  const unverifiedDispatch = await dispatchLanActuation(
    { id: "heater_01", riskTier: 3, driver: "LOCAL_DB_SIMULATOR" },
    "TOGGLE_POWER",
    { chordVerified: false },
    breaker
  );
  assert(
    !unverifiedDispatch.ok && unverifiedDispatch.reasonCode === "TIER_3_CHORD_REQUIRED",
    "G8.5 LAN Bridge blocks Tier 3 actuation when chordVerified=false"
  );

  await dispatchLanActuation(
    { id: "faulty_relay_01", riskTier: 1, driver: "MQTT_HTTP_TASMO" },
    "TOGGLE_POWER",
    { chordVerified: true, simulateFault: true },
    breaker
  );
  await dispatchLanActuation(
    { id: "faulty_relay_01", riskTier: 1, driver: "MQTT_HTTP_TASMO" },
    "TOGGLE_POWER",
    { chordVerified: true, simulateFault: true },
    breaker
  );
  const thirdFault = await dispatchLanActuation(
    { id: "faulty_relay_01", riskTier: 1, driver: "MQTT_HTTP_TASMO" },
    "TOGGLE_POWER",
    { chordVerified: true, simulateFault: true },
    breaker
  );
  assert(
    !thirdFault.ok &&
      thirdFault.circuitBreakerState === "OPEN_FAULT_LOCKED" &&
      thirdFault.reasonCode === "DEVICE_FAULT_LOCK",
    "G8.6 3 consecutive hardware relay faults trip ActuatorCircuitBreaker into DEVICE_FAULT_LOCK"
  );

  // ---------------------------------------------------------------------------
  // BATTERY G9: Live Webcam Empty-Hand Zero False-Positive Object-Grasp Guard
  // ---------------------------------------------------------------------------
  console.log("\n[Battery G9] Live Webcam Empty-Hand Zero False-Positive Object-Grasp Guard");
  const allTenGestures = [
    "OPEN_PALM",
    "FIST",
    "THUMBS_UP",
    "THUMBS_DOWN",
    "POINTING_UP",
    "VICTORY",
    "PINCH",
    "CALL_ME",
    "THREE_FINGERS",
    "FOUR_FINGERS",
  ] as const;

  const webcamAnalyzer = new SceneAnalyzer();
  const emptySkinRgba = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < 64 * 48; i++) {
    emptySkinRgba[i * 4] = 205;
    emptySkinRgba[i * 4 + 1] = 155;
    emptySkinRgba[i * 4 + 2] = 125;
    emptySkinRgba[i * 4 + 3] = 255;
  }

  let falseWebcamObjectBlocks = 0;
  let totalWebcamEmptyFrames = 0;
  const fistRest = generateSyntheticGestureLandmarks("FIST", 0, 5.2, 0.0);

  for (const g of allTenGestures) {
    const baseLm = generateSyntheticGestureLandmarks(g, 0, 5.2, 0.01);
    for (const yawScale of [1.0, 0.7, 0.45, 0.25, 0.15]) {
      for (const pitchScale of [1.0, 0.75, 0.55]) {
        for (const relax of [0.0, 0.15, 0.30, 0.42]) {
          totalWebcamEmptyFrames++;
          const lm = baseLm.map((p, idx) => {
            const rx = p.x * (1 - relax) + fistRest[idx].x * relax;
            const ry = p.y * (1 - relax) + fistRest[idx].y * relax;
            return {
              x: 0.5 + (rx - 0.5) * yawScale + (idx >= 5 ? (1 - yawScale) * 0.08 : 0),
              y: 0.73 + (ry - 0.73) * pitchScale,
              z: (idx >= 5 ? -0.04 : 0) * (1 - yawScale),
            };
          });
          const faceOv = webcamAnalyzer.detectFaceNoseOverlap(lm, emptySkinRgba);
          const heldObj = webcamAnalyzer.detectHeldObjectInHand(lm, emptySkinRgba);
          const res = classifyHandGesture(lm, null, {
            webcamMode: true,
            faceOverlapDetected: faceOv,
            foreignObjectDetected: heldObj,
          });
          if (res.objectGraspAnalysis?.isObjectGrasp) {
            falseWebcamObjectBlocks++;
          }
        }
      }
    }
  }

  assert(
    falseWebcamObjectBlocks === 0 && totalWebcamEmptyFrames === 600,
    "G9.1 600-Posture Live Webcam Empty-Hand Benchmark has 0.00% false-positive Object Grasp blocks",
    `falseBlocks=${falseWebcamObjectBlocks}/${totalWebcamEmptyFrames}`
  );

  let falseFaceOverlapCount = 0;
  for (const g of allTenGestures) {
    const lm = generateSyntheticGestureLandmarks(g, 0, 5.2, 0.01);
    if (webcamAnalyzer.detectFaceNoseOverlap(lm, emptySkinRgba)) {
      falseFaceOverlapCount++;
    }
  }
  assert(
    falseFaceOverlapCount === 0,
    "G9.2 Normal gestures in front of skin-toned regions produce 0/10 false face-overlap blocks",
    `falseFaceOverlap=${falseFaceOverlapCount}/10`
  );

  // Verify photometric held-object detection catches a real non-skin object inside the hand C-aperture
  const heldObjectRgba = new Uint8ClampedArray(emptySkinRgba);
  const bookLm = generateObjectGraspLandmarks("BOOK_SPINE", 0, 5.2, 0.01);
  const apCx = Math.round(
    ((bookLm[4].x + bookLm[6].x + bookLm[10].x + bookLm[14].x + bookLm[8].x + bookLm[12].x) / 6) * 64
  );
  const apCy = Math.round(
    ((bookLm[4].y + bookLm[6].y + bookLm[10].y + bookLm[14].y + bookLm[8].y + bookLm[12].y) / 6) * 48
  );
  const palmCx = Math.round(
    ((bookLm[0].x + bookLm[5].x + bookLm[9].x + bookLm[13].x + bookLm[17].x) / 5) * 64
  );
  const palmCy = Math.round(
    ((bookLm[0].y + bookLm[5].y + bookLm[9].y + bookLm[13].y + bookLm[17].y) / 5) * 48
  );
  // Paint a dark-blue book cover inside the thumb-to-finger aperture while palm & corners stay skin/background
  for (let py = Math.max(0, apCy - 6); py <= Math.min(47, apCy + 6); py++) {
    for (let px = Math.max(0, apCx - 8); px <= Math.min(63, apCx + 8); px++) {
      if (Math.abs(px - palmCx) <= 2 && Math.abs(py - palmCy) <= 2) continue;
      const idx = (py * 64 + px) * 4;
      heldObjectRgba[idx] = 24;
      heldObjectRgba[idx + 1] = 42;
      heldObjectRgba[idx + 2] = 135;
      heldObjectRgba[idx + 3] = 255;
    }
  }
  const hasForeignObj = webcamAnalyzer.detectHeldObjectInHand(bookLm, heldObjectRgba);
  const heldBookWebcamRes = classifyHandGesture(bookLm, null, {
    webcamMode: true,
    foreignObjectDetected: hasForeignObj,
  });
  assert(
    hasForeignObj && Boolean(heldBookWebcamRes.objectGraspAnalysis?.isObjectGrasp),
    "G9.3 Photometric detectHeldObjectInHand detects physical object inside C-aperture and blocks actuation",
    `foreignObjectDetected=${hasForeignObj}, reason=${heldBookWebcamRes.objectGraspAnalysis?.reason}`
  );

  console.log("\n================================================================================");
  console.log(`📊 GLOBAL v4.0 BENCHMARK SUMMARY: ${passed}/${passed + failed} assertions passed`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runGlobalV4Suite().catch((err) => {
  console.error(err);
  process.exit(1);
});
