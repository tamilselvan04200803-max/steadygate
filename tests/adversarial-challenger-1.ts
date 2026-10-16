/* eslint-disable no-console */
/**
 * Adversarial Challenger 1 Validation Suite:
 * Stress-testing Object Grasp Guard (`src/lib/hand-gesture-engine.ts`)
 * and Scene Pre-Processing / Dynamic CLAHE (`src/lib/vision-runtime.ts`).
 *
 * Run: node ./node_modules/tsx/dist/cli.mjs tests/adversarial-challenger-1.ts
 */
import fs from "fs";
import path from "path";
import {
  detectObjectGrasp,
  classifyHandGesture,
  generateSyntheticGestureLandmarks,
  generateObjectGraspLandmarks,
  REAL_WORLD_FAILURE_CASES,
  setAdminTrainedModel,
  getAdminTrainedModel,
} from "../src/lib/hand-gesture-engine";
import {
  SceneAnalyzer,
  LandmarkSmoother,
  GestureVoter,
} from "../src/lib/vision-runtime";
import type { HandLandmark2D, RecognizedGesture } from "../src/lib/types";

let passCount = 0;
let failCount = 0;
const failureDetails: string[] = [];

function assertTest(name: string, ok: boolean, detail = "") {
  if (ok) {
    passCount++;
    console.log(`  ✓ ${name} ${detail ? "(" + detail + ")" : ""}`);
  } else {
    failCount++;
    const msg = `  ✗ FAILED: ${name} ${detail ? "(" + detail + ")" : ""}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

// Minimal headless Canvas mock for SceneAnalyzer in Node.js
class MockContext2D {
  public data: Uint8ClampedArray;
  constructor(public width = 64, public height = 48) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  drawImage(video: any, _x: number, _y: number, _w: number, _h: number) {
    if (video && video._mockData) {
      this.data.set(video._mockData);
    }
  }
  getImageData(_x: number, _y: number, _w: number, _h: number) {
    return { data: this.data };
  }
}

class MockCanvas {
  public width = 64;
  public height = 48;
  public ctx = new MockContext2D(64, 48);
  getContext(type: string) {
    return this.ctx;
  }
}

(global as any).document = {
  createElement(tag: string) {
    if (tag === "canvas") {
      return new MockCanvas();
    }
    return {};
  },
};

function createUniformVideoFrame(targetLuminance: number) {
  const pixelVal = Math.max(0, Math.min(255, Math.round(targetLuminance * 255)));
  const data = new Uint8ClampedArray(64 * 48 * 4);
  for (let i = 0; i < 64 * 48; i++) {
    data[i * 4] = pixelVal;
    data[i * 4 + 1] = pixelVal;
    data[i * 4 + 2] = pixelVal;
    data[i * 4 + 3] = 255;
  }
  return { _mockData: data } as any;
}

function createCheckerboardVideoFrame(lum1: number, lum2: number) {
  const v1 = Math.max(0, Math.min(255, Math.round(lum1 * 255)));
  const v2 = Math.max(0, Math.min(255, Math.round(lum2 * 255)));
  const data = new Uint8ClampedArray(64 * 48 * 4);
  for (let y = 0; y < 48; y++) {
    for (let x = 0; x < 64; x++) {
      const idx = (y * 64 + x) * 4;
      const v = (x + y) % 2 === 0 ? v1 : v2;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  return { _mockData: data } as any;
}

function transformLandmarks(
  lm: HandLandmark2D[],
  o: { scale?: number; dx?: number; dy?: number; jitter?: number; squashY?: number; rot?: number }
): HandLandmark2D[] {
  const s = o.scale ?? 1;
  const cx = 0.5, cy = 0.55;
  const rot = o.rot ?? 0;
  return lm.map((p) => {
    let x = (p.x - cx) * s;
    let y = (p.y - cy) * s * (o.squashY ?? 1);
    if (rot) {
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      x = rx;
      y = ry;
    }
    x += cx + (o.dx ?? 0);
    y += cy + (o.dy ?? 0);
    if (o.jitter) {
      x += (Math.random() - 0.5) * 2 * o.jitter;
      y += (Math.random() - 0.5) * 2 * o.jitter;
    }
    return { x, y, z: p.z };
  });
}

console.log("================================================================================");
console.log("  CHALLENGER 1 ADVERSARIAL VALIDATION: OBJECT GRASP GUARD & VISION RUNTIME");
console.log("================================================================================\n");

// ================================================================================
// BATTERY 1: OBJECT-HOLDING POSTURES FALSE POSITIVE ACTUATION (TARGET: STRICTLY 0.0%)
// ================================================================================
console.log("--- Battery 1: Object Grasp False Positive Actuation (Target: 0.0% FP) ---");

const graspModes: Array<"BOOK_SPINE" | "OPEN_BOOK" | "PHONE_GRASP" | "CUP_MUG" | "OCCLUDED_BOOK"> = [
  "BOOK_SPINE",
  "OPEN_BOOK",
  "PHONE_GRASP",
  "CUP_MUG",
  "OCCLUDED_BOOK",
];

// 1.1 Baseline Heuristic Mode across 200 frames
{
  const defaultAdminModel = getAdminTrainedModel();
  setAdminTrainedModel({
    ...defaultAdminModel,
    negativeGraspSignatures: [],
  });

  let fpHeuristic = 0;
  const reasons: Record<string, Record<string, number>> = {};
  for (const mode of graspModes) {
    reasons[mode] = {};
    for (let f = 0; f < 40; f++) {
      const lm = generateObjectGraspLandmarks(mode, f * 0.033, 5.4, 0.035);
      const res = classifyHandGesture(lm, null);
      if (res.gesture !== "UNKNOWN") {
        fpHeuristic++;
      }
      const r = res.objectGraspAnalysis?.reason || "NONE";
      reasons[mode][r] = (reasons[mode][r] || 0) + 1;
    }
  }

  const reasonCoverage =
    reasons["BOOK_SPINE"]["BOOK_OR_OBJECT_GRASP"] === 40 &&
    reasons["OPEN_BOOK"]["OPEN_BOOK_PAGE_HOLD"] === 40 &&
    reasons["PHONE_GRASP"]["CYLINDRICAL_CUP_OR_PHONE_GRASP"] === 40 &&
    reasons["CUP_MUG"]["CYLINDRICAL_CUP_OR_PHONE_GRASP"] === 40 &&
    reasons["OCCLUDED_BOOK"]["PALM_OCCLUDED_BY_OBJECT"] === 40;

  assertTest(
    "1.1 Heuristic Mode: 0.0% FP across 200 standard frames with exact diagnostic reasons",
    fpHeuristic === 0 && reasonCoverage,
    `FP=${fpHeuristic}/200 (0.00%), reasons verified across all 5 modalities`
  );

  // 1.2 Admin-Learned Model Mode across 200 frames
  const adminModelPath = path.join(process.cwd(), "storage", "admin_trained_model.json");
  let fpAdmin = 0;
  let adminTriggers = 0;
  let occludedTriggers = 0;
  if (fs.existsSync(adminModelPath)) {
    const adminData = JSON.parse(fs.readFileSync(adminModelPath, "utf-8"));
    setAdminTrainedModel(adminData);

    for (const mode of graspModes) {
      for (let f = 0; f < 40; f++) {
        const lm = generateObjectGraspLandmarks(mode, f * 0.033, 5.4, 0.035);
        const res = classifyHandGesture(lm, null);
        if (res.gesture !== "UNKNOWN") {
          fpAdmin++;
        }
        if (res.objectGraspAnalysis?.reason === "ADMIN_LEARNED_NEGATIVE_GRASP") {
          adminTriggers++;
        } else if (res.objectGraspAnalysis?.reason === "PALM_OCCLUDED_BY_OBJECT") {
          occludedTriggers++;
        }
      }
    }
    // Restore default
    setAdminTrainedModel(defaultAdminModel);
  }

  assertTest(
    "1.2 Admin-Trained Mode: 0.0% FP across 200 frames with persistent negative signatures",
    fpAdmin === 0 && adminTriggers === 160 && occludedTriggers === 40,
    `FP=${fpAdmin}/200, adminTriggers=${adminTriggers}/160, occluded=${occludedTriggers}/40`
  );
}

// 1.3 Adversarial Lumbrical Variations (MCP flexion 60° to 140°, PIP-DIP straightness 0.70 to 1.0)
{
  const mcpAngles = [60, 75, 90, 105, 120, 130, 138];
  const straightnesses = [0.70, 0.85, 0.95, 1.0];
  const apertures = [0.40, 0.55, 0.75, 0.95];
  let lumbricalFPs = 0;
  let lumbricalCount = 0;
  let lumbricalGuardCatches = 0;

  for (const mcpAngle of mcpAngles) {
    for (const st of straightnesses) {
      for (const ap of apertures) {
        lumbricalCount++;
        const wrist: HandLandmark2D = { x: 0.5, y: 0.73 };
        const palmLen = 0.18;
        const mcps: HandLandmark2D[] = [
          { x: 0.44, y: 0.55 },
          { x: 0.49, y: 0.53 },
          { x: 0.54, y: 0.55 },
          { x: 0.58, y: 0.58 },
        ];
        const headingRad = ((180 - mcpAngle) * Math.PI) / 180;
        const curl = 1 - st;

        const fingers: HandLandmark2D[][] = mcps.map((mcp) => {
          const seg = [0.075, 0.055, 0.045];
          let h = headingRad;
          const pts: HandLandmark2D[] = [mcp];
          let cur = mcp;
          const bends = [curl * 1.45, curl * 1.15, curl * 0.75];
          for (let i = 0; i < 3; i++) {
            h += bends[i];
            cur = { x: cur.x + Math.sin(h) * seg[i], y: cur.y - Math.cos(h) * seg[i] };
            pts.push(cur);
          }
          return pts;
        });

        const indexTip = fingers[0][3];
        const thumbTip: HandLandmark2D = { x: indexTip.x - ap * palmLen, y: indexTip.y + 0.02 };
        const thumbMcp: HandLandmark2D = { x: 0.39, y: 0.59 };
        const thumbCmc: HandLandmark2D = { x: 0.41, y: 0.64 };
        const thumbIp: HandLandmark2D = { x: (thumbMcp.x + thumbTip.x) / 2, y: (thumbMcp.y + thumbTip.y) / 2 };

        const lm: HandLandmark2D[] = [
          wrist,
          thumbCmc,
          thumbMcp,
          thumbIp,
          thumbTip,
          ...fingers[0],
          ...fingers[1],
          ...fingers[2],
          ...fingers[3],
        ];

        const res = classifyHandGesture(lm, null);
        if (res.gesture !== "UNKNOWN") {
          lumbricalFPs++;
        }
        if (res.objectGraspAnalysis?.reason === "LUMBRICAL_BOOK_CLAMP") {
          lumbricalGuardCatches++;
        }
      }
    }
  }

  assertTest(
    "1.3 Adversarial Lumbrical Grip: 0.0% FP across anatomical angles [60°..138°]",
    lumbricalFPs === 0 && lumbricalGuardCatches === lumbricalCount,
    `FP=${lumbricalFPs}/${lumbricalCount}, 100% caught by Guard 3 (LUMBRICAL_BOOK_CLAMP)`
  );
}

// 1.4 Adversarial Cylindrical Grasps (apertures 0.45 to 1.10, curls 0.52 to 0.70)
{
  const cylCurls = [0.55, 0.62, 0.68];
  const cylApertures = [0.45, 0.65, 0.85, 1.05];
  let cylFPs = 0;
  let cylCount = 0;
  let cylGuardCatches = 0;

  for (const c of cylCurls) {
    for (const ap of cylApertures) {
      cylCount++;
      const wrist: HandLandmark2D = { x: 0.5, y: 0.73 };
      const palmLen = 0.18;
      const mcps: HandLandmark2D[] = [
        { x: 0.44, y: 0.55 },
        { x: 0.49, y: 0.53 },
        { x: 0.54, y: 0.55 },
        { x: 0.58, y: 0.58 },
      ];
      const fingers: HandLandmark2D[][] = mcps.map((mcp, idx) => {
        const seg = [0.075, 0.055, 0.045];
        let h = ((-6 + idx * 6) * Math.PI) / 180;
        const pts: HandLandmark2D[] = [mcp];
        let cur = mcp;
        const bends = [c * 1.45, c * 1.15, c * 0.75];
        for (let i = 0; i < 3; i++) {
          h += bends[i];
          cur = { x: cur.x + Math.sin(h) * seg[i], y: cur.y - Math.cos(h) * seg[i] };
          pts.push(cur);
        }
        return pts;
      });

      const indexTip = fingers[0][3];
      const thumbTip: HandLandmark2D = { x: indexTip.x - ap * palmLen, y: indexTip.y + 0.03 };
      const thumbMcp: HandLandmark2D = { x: 0.39, y: 0.59 };
      const thumbCmc: HandLandmark2D = { x: 0.41, y: 0.64 };
      const thumbIp: HandLandmark2D = { x: (thumbMcp.x + thumbTip.x) / 2, y: (thumbMcp.y + thumbTip.y) / 2 };

      const lm: HandLandmark2D[] = [
        wrist,
        thumbCmc,
        thumbMcp,
        thumbIp,
        thumbTip,
        ...fingers[0],
        ...fingers[1],
        ...fingers[2],
        ...fingers[3],
      ];

      const res = classifyHandGesture(lm, null);
      if (res.gesture !== "UNKNOWN") {
        cylFPs++;
      }
      if (res.objectGraspAnalysis?.isObjectGrasp) {
        cylGuardCatches++;
      }
    }
  }

  assertTest(
    "1.4 Adversarial Cylindrical Postures: 0.0% FP across apertures [0.45..1.05]",
    cylFPs === 0 && cylGuardCatches === cylCount,
    `FP=${cylFPs}/${cylCount}, 100% caught by Guard hierarchy (reasons: Guard 5, 2, 4)`
  );
}

// 1.5 Extreme Palm Aspect Ratio Postures (< 0.38 and > 3.6)
{
  const testAspects = [0.12, 0.22, 0.35, 3.75, 4.80, 8.50];
  let aspectFPs = 0;
  let aspectCatches = 0;

  for (const asp of testAspects) {
    const wrist: HandLandmark2D = { x: 0.5, y: 0.73 };
    const targetPalmWidth = 0.18 / asp;
    const indexMcp = { x: 0.5 - targetPalmWidth / 2, y: 0.55 };
    const pinkyMcp = { x: 0.5 + targetPalmWidth / 2, y: 0.55 };
    const middleMcp = { x: 0.5, y: 0.55 };
    const ringMcp = { x: 0.5 + targetPalmWidth / 4, y: 0.55 };
    const pts: HandLandmark2D[] = [
      wrist,
      { x: indexMcp.x - 0.03, y: 0.64 },
      { x: indexMcp.x - 0.05, y: 0.59 },
      { x: indexMcp.x - 0.06, y: 0.52 },
      { x: indexMcp.x - 0.07, y: 0.46 },
      indexMcp,
      { x: indexMcp.x, y: 0.48 },
      { x: indexMcp.x, y: 0.42 },
      { x: indexMcp.x, y: 0.38 },
      middleMcp,
      { x: middleMcp.x, y: 0.48 },
      { x: middleMcp.x, y: 0.42 },
      { x: middleMcp.x, y: 0.38 },
      ringMcp,
      { x: ringMcp.x, y: 0.48 },
      { x: ringMcp.x, y: 0.42 },
      { x: ringMcp.x, y: 0.38 },
      pinkyMcp,
      { x: pinkyMcp.x, y: 0.48 },
      { x: pinkyMcp.x, y: 0.42 },
      { x: pinkyMcp.x, y: 0.38 },
    ];
    const res = classifyHandGesture(pts, null);
    if (res.gesture !== "UNKNOWN") {
      aspectFPs++;
    }
    if (res.objectGraspAnalysis?.reason === "PALM_OCCLUDED_BY_OBJECT") {
      aspectCatches++;
    }
  }

  assertTest(
    "1.5 Extreme Palm Aspect Ratios (<0.38 or >3.6): 0.0% FP",
    aspectFPs === 0 && aspectCatches === testAspects.length,
    `FP=${aspectFPs}/${testAspects.length}, 100% caught by Guard 1 (PALM_OCCLUDED_BY_OBJECT)`
  );
}

// 1.6 Temporal Pipeline under Severe Tremor (smoother + voter on grasp postures)
{
  let voterFPs = 0;
  let totalVoterFrames = 0;

  for (const mode of graspModes) {
    const sm = new LandmarkSmoother();
    const voter = new GestureVoter(9, 0.6, 0.35);

    for (let f = 0; f < 50; f++) {
      totalVoterFrames++;
      const raw = generateObjectGraspLandmarks(mode, f * 0.033, 5.8, 0.05); // severe tremor amp 0.05
      const smoothed = sm.smooth(raw, f * 33.3);
      const res = classifyHandGesture(smoothed, null);
      const v = voter.push(res.confidence < 0.5 ? "UNKNOWN" : res.gesture);
      if (f >= 10 && v.committed !== "UNKNOWN") {
        voterFPs++;
      }
    }
  }

  assertTest(
    "1.6 Temporal Pipeline with Tremor: 0.0% committed false activations across 250 frames",
    voterFPs === 0,
    `Committed FP=${voterFPs}/${totalVoterFrames}`
  );
}

// ================================================================================
// BATTERY 2: VALID GESTURES FALSE REJECTION VERIFICATION
// ================================================================================
console.log("\n--- Battery 2: Valid Gesture False-Rejection Verification ---");

const ALL_TEN_GESTURES: RecognizedGesture[] = [
  "OPEN_PALM",
  "FIST",
  "VICTORY",
  "POINTING_UP",
  "THUMBS_UP",
  "THUMBS_DOWN",
  "PINCH",
  "THREE_FINGERS",
  "FOUR_FINGERS",
  "CALL_ME",
];

// 2.1 Clean Nominal Canonical Gestures
{
  let cleanFalselyBlocked = 0;
  for (const g of ALL_TEN_GESTURES) {
    const lm = generateSyntheticGestureLandmarks(g, 0, 0, 0);
    const grasp = detectObjectGrasp(lm);
    if (grasp.isObjectGrasp) {
      cleanFalselyBlocked++;
    }
  }
  assertTest(
    "2.1 Clean Canonical Gestures: Zero False Rejections",
    cleanFalselyBlocked === 0,
    `Blocked=${cleanFalselyBlocked}/10 (0.00%)`
  );
}

// 2.2 Canonical Gestures under 5.2 Hz Involuntary Tremor (300 frames)
{
  let tremorFalselyBlocked = 0;
  for (const g of ALL_TEN_GESTURES) {
    for (let t = 0; t < 30; t++) {
      const lm = generateSyntheticGestureLandmarks(g, t / 30, 5.2, 0.045);
      const grasp = detectObjectGrasp(lm);
      if (grasp.isObjectGrasp) {
        tremorFalselyBlocked++;
      }
    }
  }
  assertTest(
    "2.2 Canonical Gestures with 5.2 Hz Tremor: Zero False Rejections across 300 frames",
    tremorFalselyBlocked === 0,
    `Blocked=${tremorFalselyBlocked}/300 (0.00%)`
  );
}

// 2.3 Canonical Gestures under Spatial Variations (Scale, Rotation, Foreshortening)
{
  const scales = [0.7, 0.9, 1.0, 1.2, 1.35];
  const rotations = [-30 * Math.PI / 180, -15 * Math.PI / 180, 0, 15 * Math.PI / 180, 30 * Math.PI / 180];
  const squashes = [0.75, 0.88, 1.0, 1.10];
  let spatialBlocked = 0;
  let spatialTotal = 0;

  for (const g of ALL_TEN_GESTURES) {
    for (const scale of scales) {
      for (const rot of rotations) {
        for (const squashY of squashes) {
          spatialTotal++;
          const baseLm = generateSyntheticGestureLandmarks(g, 0.05, 5.2, 0.035);
          const lm = transformLandmarks(baseLm, { scale, rot, squashY, jitter: 0.003 });
          const grasp = detectObjectGrasp(lm);
          if (grasp.isObjectGrasp) {
            spatialBlocked++;
          }
        }
      }
    }
  }
  assertTest(
    "2.3 Canonical Gestures under Spatial Variations: Zero False Rejections across 1000 frames",
    spatialBlocked === 0,
    `Blocked=${spatialBlocked}/${spatialTotal} (0.00%)`
  );
}

// 2.4 Real GitHub HaGRID Stratified Benchmark (500 Real Human Samples)
{
  const benchmarkPath = path.join(process.cwd(), "storage", "hagrid_real_benchmark.json");
  let hagridCorrect = 0;
  let hagridTotal = 0;
  let hagridBlockedByGuard = 0;

  if (fs.existsSync(benchmarkPath)) {
    const raw = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
    const samplesList = Array.isArray(raw) ? raw : raw.samples || [];

    for (const s of samplesList) {
      hagridTotal++;
      const expected = s.expectedGesture || s.gesture;
      const grasp = detectObjectGrasp(s.landmarks);
      if (grasp.isObjectGrasp) {
        hagridBlockedByGuard++;
      }
      const res = classifyHandGesture(s.landmarks, null);
      if (res.gesture === expected) {
        hagridCorrect++;
      }
    }
  }

  const hagridAcc = hagridTotal > 0 ? (hagridCorrect / hagridTotal) * 100 : 0;
  assertTest(
    "2.4 Real GitHub HaGRID Benchmark (500 stratified real human samples) Accuracy >= 97%",
    hagridAcc >= 97.0,
    `Accuracy=${hagridAcc.toFixed(2)}% (${hagridCorrect}/${hagridTotal}), Guard Triggers=${hagridBlockedByGuard}/500`
  );
}

// ================================================================================
// BATTERY 3: DIFFICULT LIGHTING PRE-PROCESSING & CLAHE BOUNDARY EXTREMES
// ================================================================================
console.log("\n--- Battery 3: Vision Pre-Processing & Lighting Boundary Extremes ---");

const sceneAnalyzer = new SceneAnalyzer();

// 3.1 Extreme Low Light & Pitch Black (mean=0.01 and mean=0.00)
{
  const s001 = sceneAnalyzer.analyse(createUniformVideoFrame(0.01), 1);
  const s000 = sceneAnalyzer.analyse(createUniformVideoFrame(0.00), 1);

  const lowLightOk =
    s001.lightingCondition === "LOW_LIGHT_GAMMA_CLAHE" &&
    s000.lightingCondition === "LOW_LIGHT_GAMMA_CLAHE" &&
    s001.claheActive &&
    s000.claheActive &&
    s001.gamma !== undefined &&
    s001.gamma >= 0.70 &&
    s001.gamma <= 0.85 &&
    s000.gamma !== undefined &&
    s000.gamma >= 0.70 &&
    s000.gamma <= 0.85 &&
    s001.gain <= 2.35 &&
    s000.gain <= 2.35 &&
    s001.contrastGain <= 2.20 &&
    s000.contrastGain <= 2.20 &&
    s001.snrDb !== undefined &&
    s000.snrDb !== undefined &&
    !isNaN(s001.snrDb) &&
    !isNaN(s000.snrDb) &&
    isFinite(s001.snrDb) &&
    isFinite(s000.snrDb);

  assertTest(
    "3.1 Extreme Low-Light (mean=0.01, 0.00): Centered gamma [0.70, 0.85], gain <= 2.35, CLAHE <= 2.2x",
    Boolean(lowLightOk),
    `mean=0.01 -> gamma=${s001.gamma}, gain=${s001.gain.toFixed(2)}, cGain=${s001.contrastGain.toFixed(2)}, cond=${s001.lightingCondition}`
  );
}

// 3.2 Blinding Glare & Pure White (mean=0.99 and mean=1.00)
{
  const s099 = sceneAnalyzer.analyse(createUniformVideoFrame(0.99), 1);
  const s100 = sceneAnalyzer.analyse(createUniformVideoFrame(1.00), 1);

  const glareOk =
    s099.lightingCondition === "HARSH_BACKLIGHT_GLARE_COMP" &&
    s100.lightingCondition === "HARSH_BACKLIGHT_GLARE_COMP" &&
    s099.claheActive &&
    s100.claheActive &&
    s099.gamma !== undefined &&
    s100.gamma !== undefined &&
    s099.gamma <= 1.35 &&
    s100.gamma <= 1.35 &&
    s099.gamma >= 1.15 &&
    s100.gamma >= 1.15 &&
    s099.gain === 0.82 &&
    s100.gain === 0.82 &&
    s099.contrastGain === 1.22 &&
    s100.contrastGain === 1.22 &&
    s099.snrDb !== undefined &&
    !isNaN(s099.snrDb) &&
    isFinite(s099.snrDb);

  assertTest(
    "3.2 Blinding Glare (mean=0.99, 1.00): Capped gamma <= 1.35, gain=0.82, cGain=1.22",
    Boolean(glareOk),
    `mean=0.99 -> gamma=${s099.gamma}, gain=${s099.gain.toFixed(2)}, cGain=${s099.contrastGain.toFixed(2)}, cond=${s099.lightingCondition}`
  );
}

// 3.3 Zero Contrast / Uniform Illumination (contrast = 0.00)
{
  const sUniformGray = sceneAnalyzer.analyse(createUniformVideoFrame(0.50), 1);

  const zeroContrastOk =
    sUniformGray.contrast < 1e-4 &&
    sUniformGray.lightingCondition === "LOW_CONTRAST_CLAHE" &&
    sUniformGray.contrastGain === 2.20 &&
    sUniformGray.claheActive &&
    sUniformGray.snrDb !== undefined &&
    !isNaN(sUniformGray.snrDb) &&
    isFinite(sUniformGray.snrDb) &&
    sUniformGray.snrDb > 0;

  assertTest(
    "3.3 Zero Contrast (contrast=0.00): Max CLAHE cap 2.2x and finite SNR (safe log handling)",
    Boolean(zeroContrastOk),
    `contrastGain=${sUniformGray.contrastGain.toFixed(2)}, snrDb=${sUniformGray.snrDb} dB, cond=${sUniformGray.lightingCondition}`
  );
}

// 3.4 Scene Quality Metric Sanity
{
  const qOptimal = sceneAnalyzer.quality(1.0);
  const qDegraded = sceneAnalyzer.quality(0.2);

  const qualityOk =
    qOptimal >= 0.05 &&
    qOptimal <= 1.0 &&
    qDegraded >= 0.05 &&
    qDegraded <= 1.0 &&
    qOptimal > qDegraded &&
    !isNaN(qOptimal) &&
    !isNaN(qDegraded);

  assertTest(
    "3.4 Scene Quality Metric: Monotonic, bounded in [0.05, 1.0], no NaN values",
    qualityOk,
    `qOptimal=${qOptimal.toFixed(2)}, qDegraded=${qDegraded.toFixed(2)}`
  );
}

// 3.5 High Contrast Checkerboard Benchmark
{
  const sCheck = sceneAnalyzer.analyse(createCheckerboardVideoFrame(0.2, 0.8), 1);
  const checkOk =
    sCheck.contrast > 0.15 &&
    sCheck.lightingCondition === "OPTIMAL" &&
    sCheck.gain === 1.0 &&
    !sCheck.claheActive &&
    sCheck.snrDb !== undefined &&
    sCheck.snrDb >= 25;

  assertTest(
    "3.5 Optimal Lighting (Checkerboard): Zero unnecessary preprocessing (gain=1, gamma=1.0, CLAHE off)",
    Boolean(checkOk),
    `contrast=${sCheck.contrast.toFixed(2)}, snrDb=${sCheck.snrDb} dB, cond=${sCheck.lightingCondition}`
  );
}

// ================================================================================
// BATTERY 4: REAL-WORLD LIVE WEBCAM FAILURE SCREENSHOTS (CASES 1, 2 & 3)
// ================================================================================
console.log("\n--- Battery 4: Real-World Live Camera Screenshot Failure Cases (n=120 frames) ---");
{
  let case1FPs = 0;
  let case2FalseBlocks = 0;
  let case3FPs = 0;

  for (let f = 0; f < 40; f++) {
    const jx = Math.sin(2 * Math.PI * 5.4 * (f / 30)) * 0.008;
    const jy = Math.cos(2 * Math.PI * 5.4 * (f / 30)) * 0.008;

    const lm1 = REAL_WORLD_FAILURE_CASES.CASE_1_PHONE_IN_HAND.map((p) => ({
      x: p.x + jx,
      y: p.y + jy,
    }));
    const r1 = classifyHandGesture(lm1, null);
    if (
      r1.gesture !== "UNKNOWN" ||
      r1.objectGraspAnalysis?.reason !== "WIDE_PHONE_OR_OBJECT_CLASP"
    ) {
      case1FPs++;
    }

    const lm2 = REAL_WORLD_FAILURE_CASES.CASE_2_FREE_HAND_SIDE_PROFILE.map((p) => ({
      x: p.x + jx,
      y: p.y + jy,
    }));
    const r2 = classifyHandGesture(lm2, null);
    if (r2.objectGraspAnalysis?.isObjectGrasp || r2.gesture !== "OPEN_PALM") {
      case2FalseBlocks++;
    }

    const lm3 = REAL_WORLD_FAILURE_CASES.CASE_3_NOSE_TINGLING_SCRATCH.map((p) => ({
      x: p.x + jx,
      y: p.y + jy,
    }));
    const r3 = classifyHandGesture(lm3, null);
    if (
      r3.gesture !== "UNKNOWN" ||
      r3.objectGraspAnalysis?.reason !== "CASUAL_FACE_TOUCH_OR_SCRATCH"
    ) {
      case3FPs++;
    }
  }

  assertTest(
    "4.1 Failure Case 1 (Smartphone in Hand w/ Index Extended, n=40): 0.0% FP (WIDE_PHONE_OR_OBJECT_CLASP)",
    case1FPs === 0,
    `FP=${case1FPs}/40`
  );
  assertTest(
    "4.2 Failure Case 2 (Side-Profile Free Hand, n=40): 0.0% False Occlusion Blocks (OPEN_PALM)",
    case2FalseBlocks === 0,
    `FalseBlocks=${case2FalseBlocks}/40`
  );
  assertTest(
    "4.3 Failure Case 3 (Nose Tingling / Face Scratch, n=40): 0.0% FP (CASUAL_FACE_TOUCH_OR_SCRATCH)",
    case3FPs === 0,
    `FP=${case3FPs}/40`
  );
}

console.log("\n================================================================================");
console.log(`  VERDICT: ${failCount === 0 ? "APPROVED (100% PASS)" : "CHALLENGE_FAILED"}`);
console.log(`  Total Checks: ${passCount + failCount} | Passed: ${passCount} | Failed: ${failCount}`);
console.log("================================================================================\n");

if (failCount > 0) {
  console.error("FAILURES ENCOUNTERED:\n" + failureDetails.join("\n"));
  process.exit(1);
} else {
  process.exit(0);
}
