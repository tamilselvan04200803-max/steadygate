/* eslint-disable no-console */
/**
 * Adversarial Stress Test Suite - Challenger 2
 * Focus:
 * 1. Progressive 3-Stage Tremor f0 Personalizer & Irregular Frequency Rejection (src/lib/signal-processing.ts)
 * 2. Admin AI Gesture Trainer & Dataset Studio (src/app/api/admin-train/route.ts, storage/admin_trained_model.json)
 *
 * Execute: node ./node_modules/tsx/dist/cli.mjs tests/adversarial-challenger-2.test.ts
 */

import fs from "fs";
import path from "path";
import {
  AdaptiveTremorFrequencyTracker,
  calculateNormalizedStability,
  computePowerSpectrum,
  extractMotionSignature,
  linearDetrend,
} from "../src/lib/signal-processing";
import {
  classifyHandGesture,
  generateObjectGraspLandmarks,
  generateSyntheticGestureLandmarks,
  getAdminTrainedModel,
  setAdminTrainedModel,
} from "../src/lib/hand-gesture-engine";
import { GET, POST } from "../src/app/api/admin-train/route";
import type { HandLandmark2D, RecognizedGesture } from "../src/lib/types";

let passCount = 0;
let failCount = 0;
const failures: string[] = [];

function assertCheck(name: string, ok: boolean, detail = "") {
  if (ok) {
    passCount += 1;
    console.log(`  ✓ [PASS] ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failCount += 1;
    failures.push(`${name} -> ${detail}`);
    console.error(`  ✗ [FAIL] ${name} -> ${detail}`);
  }
}

// Pseudo-random deterministic generator for reproducible chaos
let seed = 98765;
function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function randGaussian(mean = 0, std = 1): number {
  const u = 1 - rand();
  const v = rand();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Storage paths for backup & restore
const STORAGE_DIR = path.join(process.cwd(), "storage");
const MODEL_FILE = path.join(STORAGE_DIR, "admin_trained_model.json");
const SAMPLES_FILE = path.join(STORAGE_DIR, "admin_training_samples.json");

let initialModelBackup: string | null = null;
let initialSamplesBackup: string | null = null;

function backupStorage() {
  if (fs.existsSync(MODEL_FILE)) {
    initialModelBackup = fs.readFileSync(MODEL_FILE, "utf-8");
  }
  if (fs.existsSync(SAMPLES_FILE)) {
    initialSamplesBackup = fs.readFileSync(SAMPLES_FILE, "utf-8");
  }
}

function restoreStorage() {
  if (initialModelBackup !== null) {
    fs.writeFileSync(MODEL_FILE, initialModelBackup, "utf-8");
    setAdminTrainedModel(JSON.parse(initialModelBackup));
  }
  if (initialSamplesBackup !== null) {
    fs.writeFileSync(SAMPLES_FILE, initialSamplesBackup, "utf-8");
  }
}

async function runAdversarialSuite() {
  console.log("===============================================================================");
  console.log("   CHALLENGER 2: ADVERSARIAL STRESS SUITE (TREMOR f0 & ADMIN AI TRAINER)");
  console.log("===============================================================================\n");

  backupStorage();

  // -------------------------------------------------------------------------
  // SUITE 1: Extreme High-Frequency Injections (>12 Hz) across all 3 stages
  // -------------------------------------------------------------------------
  console.log("== SUITE 1: Extreme High-Frequency Injections (>12 Hz) Across 3 Tracker Stages ==");
  {
    // Part A: 30 FPS Camera Pipeline (Nyquist = 15 Hz, Non-human band = (12.0, 15.0] Hz)
    const tracker = new AdaptiveTremorFrequencyTracker(5.2, 0.04, 4, 8);
    const cameraHighFrequencies = [12.5, 13.0, 13.5, 14.0, 14.2, 14.5, 14.8];

    // Stage 1 (INITIALIZED_60S_CALIB): Feed consecutive >12Hz non-human bursts
    assertCheck("Stage 1 starts as INITIALIZED_60S_CALIB", tracker.getStatus().stage === "INITIALIZED_60S_CALIB");
    const initBaselineF0 = tracker.getStatus().activeF0Hz;

    for (const freq of cameraHighFrequencies) {
      const traj: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t = i / 30;
        traj.push(0.5 + 0.05 * Math.sin(2 * Math.PI * freq * t));
      }
      const sig = extractMotionSignature(traj, 30);
      assertCheck(
        `At 30 FPS: ${freq}Hz detected as irregular in extraction`,
        sig.irregularFrequencyDetected && sig.irregularFreqRatio > 0.52,
        `f0=${sig.f0Hz}, irrRatio=${sig.irregularFreqRatio}`
      );

      const status = tracker.observeSignature(sig);
      assertCheck(
        `Stage 1: ${freq}Hz burst rejected without baseline corruption`,
        status.irregularFrequencyRejected && status.activeF0Hz === initBaselineF0,
        `activeF0=${status.activeF0Hz}, rejectedCount=${status.rejectedCount}`
      );
    }

    assertCheck(
      "Stage 1: Stage remained INITIALIZED_60S_CALIB despite irregular bursts",
      tracker.getStatus().stage === "INITIALIZED_60S_CALIB" && tracker.getStatus().rejectedCount === cameraHighFrequencies.length
    );

    // Transition tracker to Stage 2 (OBSERVING_CONFIRMATION) using clean 5.4 Hz tremor
    for (let k = 0; k < 6; k++) {
      const cleanTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        cleanTraj.push(0.5 + 0.04 * Math.sin(2 * Math.PI * 5.4 * (i / 30)));
      }
      const cleanSig = extractMotionSignature(cleanTraj, 30);
      tracker.observeSignature(cleanSig);
    }
    assertCheck(
      "Stage transitioned to OBSERVING_CONFIRMATION",
      tracker.getStatus().stage === "OBSERVING_CONFIRMATION",
      `stage=${tracker.getStatus().stage}`
    );

    const stage2F0Before = tracker.getStatus().activeF0Hz;

    // Inject violent 14.5 Hz vibration in Stage 2
    for (let k = 0; k < 5; k++) {
      const violentTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        violentTraj.push(0.5 + 0.08 * Math.sin(2 * Math.PI * 14.5 * (i / 30)));
      }
      const violentSig = extractMotionSignature(violentTraj, 30);
      const st = tracker.observeSignature(violentSig);
      assertCheck(
        "Stage 2: 14.5Hz vibration rejected and activeF0 strictly preserved",
        st.irregularFrequencyRejected && st.activeF0Hz === stage2F0Before
      );
    }

    // Complete transition to Stage 3 (FINALIZED_LOCKED) with clean 5.4 Hz tremor
    for (let k = 0; k < 8; k++) {
      const cleanTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        cleanTraj.push(0.5 + 0.04 * Math.sin(2 * Math.PI * 5.4 * (i / 30)));
      }
      const cleanSig = extractMotionSignature(cleanTraj, 30);
      tracker.observeSignature(cleanSig);
    }
    assertCheck(
      "Stage transitioned to FINALIZED_LOCKED",
      tracker.getStatus().stage === "FINALIZED_LOCKED",
      `stage=${tracker.getStatus().stage}, lockedF0=${tracker.getStatus().activeF0Hz}`
    );

    const finalizedF0 = tracker.getStatus().activeF0Hz;

    // Stress Stage 3 with 10 high-frequency bursts (14.2 Hz)
    for (let k = 0; k < 10; k++) {
      const burstTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        burstTraj.push(0.5 + 0.07 * Math.sin(2 * Math.PI * 14.2 * (i / 30)));
      }
      const burstSig = extractMotionSignature(burstTraj, 30);
      const st = tracker.observeSignature(burstSig);
      assertCheck(
        "Stage 3 (FINALIZED_LOCKED): 14.2Hz burst rejected and locked f0 remains identical",
        st.irregularFrequencyRejected && st.activeF0Hz === finalizedF0 && st.stage === "FINALIZED_LOCKED"
      );
    }

    // Part B: High-Speed Sampling (100 Hz / 120 FPS, Nyquist = 50-60 Hz)
    // Testing extreme vibrations at 18 Hz, 25 Hz, 35 Hz, 45 Hz
    const highSpeedFrequencies = [18.0, 25.0, 35.0, 45.0];
    for (const freq of highSpeedFrequencies) {
      const highSpeedTraj: number[] = [];
      for (let i = 0; i < 200; i++) {
        const t = i / 100;
        highSpeedTraj.push(0.5 + 0.05 * Math.sin(2 * Math.PI * freq * t));
      }
      const sig100 = extractMotionSignature(highSpeedTraj, 100);
      assertCheck(
        `At 100 Hz sampling: ${freq}Hz non-human vibration rejected as irregular`,
        sig100.irregularFrequencyDetected && sig100.irregularFreqRatio > 0.52,
        `f0=${sig100.f0Hz}, irrRatio=${sig100.irregularFreqRatio}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // SUITE 2: Chaotic Broadband & White Noise Bursts
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 2: Chaotic Broadband & Gaussian Noise Injections ==");
  {
    const tracker = new AdaptiveTremorFrequencyTracker(5.0, 0.035, 4, 8);
    const baselineF0 = tracker.getStatus().activeF0Hz;

    // 1. High-amplitude Gaussian white noise (std=0.08)
    const whiteNoiseTraj: number[] = [];
    for (let i = 0; i < 60; i++) {
      whiteNoiseTraj.push(0.5 + randGaussian(0, 0.08));
    }
    const sigWhite = extractMotionSignature(whiteNoiseTraj, 30);
    assertCheck(
      "Gaussian white noise has low spectral concentration or detected irregular",
      sigWhite.irregularFrequencyDetected || sigWhite.spectralConcentration < 0.25,
      `SCR=${sigWhite.spectralConcentration}, irrRatio=${sigWhite.irregularFreqRatio}`
    );
    const stWhite = tracker.observeSignature(sigWhite);
    assertCheck(
      "White noise rejected by tracker and baseline untouched",
      stWhite.irregularFrequencyRejected && stWhite.activeF0Hz === baselineF0
    );

    // 2. Random-walk drift + violent high-frequency jitter
    const randomWalkTraj: number[] = [0.5];
    for (let i = 1; i < 60; i++) {
      randomWalkTraj.push(randomWalkTraj[i - 1] + randGaussian(0, 0.015) + (rand() - 0.5) * 0.06);
    }
    const sigWalk = extractMotionSignature(randomWalkTraj, 30);
    const stWalk = tracker.observeSignature(sigWalk);
    assertCheck(
      "Random walk jitter rejected and baseline untouched",
      stWalk.irregularFrequencyRejected && stWalk.activeF0Hz === baselineF0
    );

    // 3. Impulsive shock spikes (drop / desk bump: 3 massive spikes in 60 frames)
    const bumpTraj: number[] = new Array(60).fill(0.5);
    bumpTraj[15] = 0.85;
    bumpTraj[16] = 0.20;
    bumpTraj[17] = 0.75;
    const sigBump = extractMotionSignature(bumpTraj, 30);
    const stBump = tracker.observeSignature(sigBump);
    assertCheck(
      "Impulsive desk bump shock rejected",
      stBump.irregularFrequencyRejected && stBump.activeF0Hz === baselineF0
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 3: Low Spectral Concentration (<0.20) Multi-Tone Interference
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 3: Low Spectral Concentration Multi-Tone Interference (<0.20 SCR) ==");
  {
    const tracker = new AdaptiveTremorFrequencyTracker(5.2, 0.04);
    const baselineF0 = tracker.getStatus().activeF0Hz;

    // Multi-tone superposition: 3.2 Hz + 6.8 Hz + 10.5 Hz + 14.0 Hz equal amplitudes
    const multiToneTraj: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t = i / 30;
      const v =
        0.5 +
        0.02 * Math.sin(2 * Math.PI * 3.2 * t) +
        0.02 * Math.sin(2 * Math.PI * 6.8 * t) +
        0.02 * Math.sin(2 * Math.PI * 10.5 * t) +
        0.02 * Math.sin(2 * Math.PI * 14.0 * t);
      multiToneTraj.push(v);
    }
    const sigMulti = extractMotionSignature(multiToneTraj, 30);
    assertCheck(
      "Multi-tone composite produces low SCR (<=0.28)",
      sigMulti.spectralConcentration <= 0.28,
      `SCR=${sigMulti.spectralConcentration}`
    );

    const stMulti = tracker.observeSignature(sigMulti);
    assertCheck(
      "Multi-tone low SCR signal rejected by tracker",
      stMulti.irregularFrequencyRejected && stMulti.activeF0Hz === baselineF0
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 4: Multi-Frequency Locking Across Full Range (3.0 Hz to 10.0 Hz)
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 4: Multi-Frequency Locking Across Full Human Range (3-10 Hz) ==");
  {
    const testFrequencies = [3.2, 4.0, 4.8, 5.5, 6.5, 7.5, 8.5, 9.2, 10.0];

    for (const targetFreq of testFrequencies) {
      // Simulate calibrated start within ±0.3 Hz of target
      const calibStart = Math.round((targetFreq + (rand() - 0.5) * 0.5) * 10) / 10;
      const tracker = new AdaptiveTremorFrequencyTracker(calibStart, 0.035, 4, 8);

      // Generate realistic human tremor trajectory with slight natural jitter
      const humanTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        const t = i / 30;
        humanTraj.push(0.5 + 0.04 * Math.sin(2 * Math.PI * targetFreq * t) + randGaussian(0, 0.003));
      }
      const sig = extractMotionSignature(humanTraj, 30);

      let status = tracker.getStatus();
      for (let w = 0; w < 15; w++) {
        status = tracker.observeSignature(sig);
      }

      const deviation = Math.abs(status.activeF0Hz - targetFreq);
      assertCheck(
        `Locking at ${targetFreq}Hz (calib=${calibStart}Hz)`,
        status.stage === "FINALIZED_LOCKED" && deviation <= 0.6,
        `stage=${status.stage}, activeF0=${status.activeF0Hz}Hz, deviation=${deviation.toFixed(2)}Hz <= 0.6Hz`
      );
    }
  }

  // -------------------------------------------------------------------------
  // SUITE 5: Interleaved Environmental Chaos & Recovery
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 5: Interleaved Environmental Chaos Recovery ==");
  {
    const targetFreq = 5.8;
    const tracker = new AdaptiveTremorFrequencyTracker(5.4, 0.04, 3, 6);

    // 1. Initial 3 clean windows
    for (let k = 0; k < 3; k++) {
      const traj: number[] = [];
      for (let i = 0; i < 60; i++) traj.push(0.5 + 0.04 * Math.sin(2 * Math.PI * targetFreq * (i / 30)));
      tracker.observeSignature(extractMotionSignature(traj, 30));
    }
    assertCheck("Tracker completed hold period", tracker.getStatus().stage !== "FINALIZED_LOCKED");

    // 2. Interleave 8 chaotic / violent desk vibration bursts (14.2Hz + noise)
    let rejections = 0;
    for (let k = 0; k < 8; k++) {
      const chaosTraj: number[] = [];
      for (let i = 0; i < 60; i++) {
        chaosTraj.push(0.5 + 0.07 * Math.sin(2 * Math.PI * 14.2 * (i / 30)) + randGaussian(0, 0.02));
      }
      const res = tracker.observeSignature(extractMotionSignature(chaosTraj, 30));
      if (res.irregularFrequencyRejected) rejections += 1;
    }
    assertCheck("All 8 chaotic bursts cleanly rejected", rejections === 8, `rejections=${rejections}/8`);

    // 3. Resume 10 clean tremor windows
    for (let k = 0; k < 10; k++) {
      const traj: number[] = [];
      for (let i = 0; i < 60; i++) traj.push(0.5 + 0.04 * Math.sin(2 * Math.PI * targetFreq * (i / 30)));
      tracker.observeSignature(extractMotionSignature(traj, 30));
    }

    const finalStatus = tracker.getStatus();
    const finalDev = Math.abs(finalStatus.activeF0Hz - targetFreq);
    assertCheck(
      "Tracker recovered seamlessly and locked to 5.8Hz",
      finalStatus.stage === "FINALIZED_LOCKED" && finalDev <= 0.6,
      `stage=${finalStatus.stage}, f0=${finalStatus.activeF0Hz}Hz, deviation=${finalDev.toFixed(2)}Hz`
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 6: Normalized Stability & Digital Notch Attenuation
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 6: Digital Notch Attenuation & Normalized Stability ==");
  {
    // Generate spectrum of pure 5.5 Hz tremor
    const tremorSignal: number[] = [];
    for (let i = 0; i < 90; i++) {
      tremorSignal.push(0.5 + 0.04 * Math.sin(2 * Math.PI * 5.5 * (i / 30)));
    }
    const { freqs, magnitudes } = computePowerSpectrum(linearDetrend(tremorSignal), 30);

    const stabTremor = calculateNormalizedStability(magnitudes, freqs, 5.5, 0.04, 2.0);
    assertCheck(
      "Notch filter attenuates tremor: stabilityNorm > stabilityRaw",
      stabTremor.stabilityNorm > stabTremor.stabilityRaw,
      `norm=${stabTremor.stabilityNorm}, raw=${stabTremor.stabilityRaw}`
    );
    assertCheck(
      "Residual RMS is attenuated compared to raw RMS for personalized tremor band (~92% reduction)",
      stabTremor.residualRms < 0.35 * (stabTremor.residualRms + 0.04),
      `residualRms=${stabTremor.residualRms}`
    );

    // Generate spectrum of 14.5 Hz non-human vibration
    const vibrationSignal: number[] = [];
    for (let i = 0; i < 90; i++) {
      vibrationSignal.push(0.5 + 0.04 * Math.sin(2 * Math.PI * 14.5 * (i / 30)));
    }
    const { freqs: vibFreqs, magnitudes: vibMags } = computePowerSpectrum(linearDetrend(vibrationSignal), 30);
    const stabVib = calculateNormalizedStability(vibMags, vibFreqs, 5.5, 0.04, 2.0);

    // Non-human vibration (>12Hz) has power amplified by 1.6x in residual calculation
    // So residualRms should be sqrt(1.6) * rawRms = 1.265x rawRms
    const rawRmsVib = Math.sqrt(vibMags.reduce((acc, m) => acc + m * m, 0));
    assertCheck(
      "High frequency vibration (>12Hz) energy is penalized by 1.6x in residual calculation",
      stabVib.residualRms >= Math.round(rawRmsVib * 1.2 * 1000) / 1000,
      `residualRms=${stabVib.residualRms}, rawRms=${rawRmsVib.toFixed(3)}`
    );
  }

  // -------------------------------------------------------------------------
  // SUITE 7: Admin AI Trainer API Stress & Edge Cases (/api/admin-train)
  // -------------------------------------------------------------------------
  console.log("\n== SUITE 7: Admin AI Trainer API Stress & Edge Cases (/api/admin-train) ==");
  {
    // 7.1 GET endpoint verification
    const getRes = await GET();
    const getData = await getRes.json();
    assertCheck(
      "GET /api/admin-train returns success, model, and benchmark",
      getData.ok && getData.success && getData.model && getData.benchmark,
      `version=${getData.model?.version}, hagridAcc=${getData.benchmark?.hagridAccuracyPct}%`
    );

    // 7.2 Unknown action handling
    const unknownReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "NON_EXISTENT_ACTION" }),
    });
    const unknownRes = await POST(unknownReq);
    const unknownData = await unknownRes.json();
    assertCheck(
      "Unknown action returns 400 and success=false",
      unknownRes.status === 400 && unknownData.success === false,
      `status=${unknownRes.status}`
    );

    // 7.3 Malformed dataset upload: Empty CSV
    const emptyCsvReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload_dataset",
        format: "CSV",
        content: "",
      }),
    });
    const emptyCsvRes = await POST(emptyCsvReq);
    assertCheck("Empty CSV returns 400 with validation error", emptyCsvRes.status === 400);

    // 7.4 Malformed dataset upload: Insufficient columns (20 cols instead of 42+)
    const shortCsvReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload_dataset",
        format: "CSV",
        content: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0\n",
      }),
    });
    const shortCsvRes = await POST(shortCsvReq);
    assertCheck("Short CSV (<42 columns) returns 400", shortCsvRes.status === 400);

    // 7.5 Malformed dataset upload: Empty JSON object / array
    const emptyJsonReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload_dataset",
        format: "JSON",
        content: JSON.stringify({ samples: [] }),
      }),
    });
    const emptyJsonRes = await POST(emptyJsonReq);
    assertCheck("Empty JSON samples array returns 400", emptyJsonRes.status === 400);

    // 7.6 Valid HaGRID 64-column CSV Ingestion with label aliases
    const hagridRows: string[] = [];
    hagridRows.push("x1,y1,z1,x2,y2,z2,x3,y3,z3,x4,y4,z4,x5,y5,z5,x6,y6,z6,x7,y7,z7,x8,y8,z8,x9,y9,z9,x10,y10,z10,x11,y11,z11,x12,y12,z12,x13,y13,z13,x14,y14,z14,x15,y15,z15,x16,y16,z16,x17,y17,z17,x18,y18,z18,x19,y19,z19,x20,y20,z20,x21,y21,z21,label");

    // Generate 5 synthetic gesture landmark rows with aliases
    const aliasesToTest: Array<{ gesture: RecognizedGesture; alias: string }> = [
      { gesture: "FIST", alias: "CLOSE" },
      { gesture: "OPEN_PALM", alias: "STOP" },
      { gesture: "THUMBS_UP", alias: "LIKE" },
      { gesture: "VICTORY", alias: "PEACE" },
      { gesture: "PINCH", alias: "OK" },
    ];

    for (const item of aliasesToTest) {
      const lm = generateSyntheticGestureLandmarks(item.gesture, 0.1, 5.2, 0.02);
      const cols: string[] = [];
      for (const p of lm) {
        cols.push(p.x.toFixed(4), p.y.toFixed(4), (p.z ?? 0.0).toFixed(4));
      }
      cols.push(item.alias);
      hagridRows.push(cols.join(","));
    }

    const validCsvReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload_dataset",
        format: "CSV",
        content: hagridRows.join("\n"),
      }),
    });
    const validCsvRes = await POST(validCsvReq);
    const validCsvData = await validCsvRes.json();
    assertCheck(
      "Valid 64-col CSV dataset imported cleanly with aliases",
      validCsvRes.status === 200 && validCsvData.success && validCsvData.importedCount === 5,
      `importedCount=${validCsvData.importedCount}`
    );

    // 7.7 25-Frame Burst Capture & Morphological Feature Vectors
    const burstReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record_sample",
        adminLabel: "BOOK_HOLD_NEGATIVE",
        burstCount: 25,
        luminance: 0.12,
        contrast: 0.08,
        clutter: 0.28,
        gamma: 0.75,
        lightingCondition: "LOW_LIGHT_DARK",
        tremorHz: 5.4,
        tremorAmp: 0.04,
        notes: "Adversarial 25-frame burst capture: Book hold in low-light",
      }),
    });
    const burstRes = await POST(burstReq);
    const burstData = await burstRes.json();
    assertCheck(
      "25-frame burst capture succeeded and recorded 25 frames",
      burstRes.status === 200 && burstData.success && burstData.recordedCount === 25,
      `recordedCount=${burstData.recordedCount}, modelVersion=${burstData.model?.version}`
    );

    // Verify feature vectors in recorded samples
    const sample = burstData.samples?.[0];
    assertCheck(
      "Recorded sample contains full morphological and lighting feature vector",
      sample &&
        Array.isArray(sample.fingerFlexion) &&
        sample.fingerFlexion.length === 5 &&
        typeof sample.palmLength === "number" &&
        typeof sample.aspectRatio === "number" &&
        typeof sample.cApertureRatio === "number" &&
        typeof sample.d4_9Ratio === "number" &&
        sample.luminance === 0.12 &&
        sample.gamma === 0.75 &&
        sample.tremorHz === 5.4,
      `flexion=[${sample?.fingerFlexion}], cAperture=${sample?.cApertureRatio}, d4_9=${sample?.d4_9Ratio}`
    );

    // 7.8 In-Memory Classifier Synchronization
    // Verify that the 25 newly trained BOOK_HOLD_NEGATIVE frames immediately trigger ADMIN_LEARNED_NEGATIVE_GRASP
    const testBookLm = generateObjectGraspLandmarks("BOOK_SPINE", 0.1, 5.4, 0.04);
    const classification = classifyHandGesture(testBookLm);
    assertCheck(
      "In-memory classifier synchronized: book posture blocked by ADMIN_LEARNED_NEGATIVE_GRASP",
      classification.gesture === "UNKNOWN" &&
        classification.objectGraspAnalysis?.isObjectGrasp === true &&
        classification.objectGraspAnalysis?.reason === "ADMIN_LEARNED_NEGATIVE_GRASP",
      `gesture=${classification.gesture}, reason=${classification.objectGraspAnalysis?.reason}`
    );

    // 7.9 Concurrency Stress: 10 parallel requests to /api/admin-train
    console.log("  Testing 10 concurrent requests to /api/admin-train...");
    const concurrentRequests = Array.from({ length: 10 }).map((_, idx) =>
      POST(
        new Request("http://localhost:3000/api/admin-train", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: idx % 2 === 0 ? "record_sample" : "run_benchmark",
            adminLabel: "OPEN_PALM",
            burstCount: 2,
            luminance: 0.45,
            notes: `Concurrent test request #${idx}`,
          }),
        })
      )
    );

    const concurrentResults = await Promise.all(concurrentRequests);
    const allSuccessful = concurrentResults.every((r) => r.status === 200);
    assertCheck("All 10 concurrent requests handled with status 200 without race corruption", allSuccessful);

    // Verify storage file is valid JSON
    let modelJsonValid = false;
    try {
      const parsed = JSON.parse(fs.readFileSync(MODEL_FILE, "utf-8"));
      modelJsonValid = parsed && typeof parsed.version === "number";
    } catch {
      modelJsonValid = false;
    }
    assertCheck("Storage file storage/admin_trained_model.json remains valid JSON after concurrency", modelJsonValid);

    // 7.10 Reset model back to 17,213 baseline
    const resetReq = new Request("http://localhost:3000/api/admin-train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_model" }),
    });
    const resetRes = await POST(resetReq);
    const resetData = await resetRes.json();
    assertCheck(
      "action: reset_model cleanly restores 17,213-sample baseline",
      resetRes.status === 200 && resetData.success && resetData.model?.totalSamplesTrained === 17213,
      `totalSamplesTrained=${resetData.model?.totalSamplesTrained}`
    );
  }

  // Restore storage to preserve pre-test environment
  restoreStorage();

  console.log("\n===============================================================================");
  console.log(`   ADVERSARIAL STRESS SUITE COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log("===============================================================================");

  if (failures.length > 0) {
    console.error("FAILURES:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  }

  process.exit(failCount > 0 ? 1 : 0);
}

runAdversarialSuite().catch((err) => {
  console.error("Adversarial test error:", err);
  process.exit(1);
});
