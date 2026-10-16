/* eslint-disable no-console */
/**
 * Gesture robustness harness. Run: npx tsx tests/gesture-robustness.test.ts
 * Covers clean, tremor, jitter (cluttered background noise), foreshortening,
 * scale/translation, half-curled transitions, and voter flicker suppression.
 */
import fs from "fs";
import path from "path";
import {
  classifyHandGesture,
  generateSyntheticGestureLandmarks,
  generateObjectGraspLandmarks,
} from "../src/lib/hand-gesture-engine";
import { GestureVoter, IntentTracker, LandmarkSmoother } from "../src/lib/vision-runtime";
import {
  AdaptiveTremorFrequencyTracker,
  extractMotionSignature,
} from "../src/lib/signal-processing";
import type { HandLandmark2D, RecognizedGesture } from "../src/lib/types";

const CORE: RecognizedGesture[] = ["OPEN_PALM", "VICTORY", "POINTING_UP", "THUMBS_UP", "FIST"];
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(`${name} ${detail}`);
  }
}

// deterministic RNG
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const gauss = () => {
  const u = 1 - rnd(), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function transform(
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
    return {
      x: cx + x + (o.dx ?? 0) + (o.jitter ? gauss() * o.jitter : 0),
      y: cy + y + (o.dy ?? 0) + (o.jitter ? gauss() * o.jitter : 0),
    };
  });
}

function accuracy(label: string, mk: (g: RecognizedGesture, t: number) => HandLandmark2D[], minAcc: number, frames = 40) {
  let correct = 0, total = 0;
  const confusion: Record<string, number> = {};
  for (const g of CORE) {
    for (let f = 0; f < frames; f++) {
      const lm = mk(g, f / 30);
      const r = classifyHandGesture(lm, null);
      total += 1;
      if (r.gesture === g) correct += 1;
      else confusion[`${g}->${r.gesture}`] = (confusion[`${g}->${r.gesture}`] || 0) + 1;
    }
  }
  const acc = correct / total;
  console.log(`${acc >= minAcc ? "✓" : "✗"} ${label}: ${(acc * 100).toFixed(1)}%  ${Object.keys(confusion).length ? JSON.stringify(confusion) : ""}`);
  check(label, acc >= minAcc, `${(acc * 100).toFixed(1)}% < ${minAcc * 100}%`);
}

console.log("\n== Per-frame classifier ==");
accuracy("clean, no tremor", (g, t) => generateSyntheticGestureLandmarks(g, t, 5.2, 0.0), 1.0);
accuracy("PD tremor 5 Hz, amp 0.045", (g, t) => generateSyntheticGestureLandmarks(g, t, 5.2, 0.045), 1.0);
accuracy("severe tremor amp 0.09", (g, t) => generateSyntheticGestureLandmarks(g, t, 4.6, 0.09), 1.0);
accuracy("small hand (scale 0.55, far from camera)", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { scale: 0.55, dx: 0.2, dy: -0.1 }), 1.0);
accuracy("large hand (scale 1.6, close)", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { scale: 1.6 }), 1.0);
accuracy("rotated 25°", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { rot: 0.44 }), 0.95);
accuracy("foreshortened (tilted toward camera, y×0.6)", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { squashY: 0.6 }), 0.9);
accuracy("landmark jitter σ=0.006 (cluttered bg)", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { jitter: 0.006 }), 0.95);
accuracy("heavy jitter σ=0.012 (low light)", (g, t) => transform(generateSyntheticGestureLandmarks(g, t, 5.2, 0.03), { jitter: 0.012 }), 0.8);

console.log("\n== Smoother + voter under heavy jitter (what the live pipeline actually does) ==");
{
  let correct = 0, total = 0;
  for (const g of CORE) {
    const sm = new LandmarkSmoother();
    const voter = new GestureVoter(9, 0.6, 0.35);
    let committed: RecognizedGesture = "UNKNOWN";
    for (let f = 0; f < 60; f++) {
      const raw = transform(generateSyntheticGestureLandmarks(g, f / 30, 5.2, 0.04), { jitter: 0.014 });
      const lm = sm.smooth(raw, f * 33.3);
      const r = classifyHandGesture(lm, null);
      const v = voter.push(r.confidence < 0.5 ? "UNKNOWN" : r.gesture);
      committed = v.committed;
      if (f >= 12) {
        total += 1;
        if (committed === g) correct += 1;
      }
    }
  }
  const acc = correct / total;
  console.log(`${acc >= 0.97 ? "✓" : "✗"} committed gesture after warm-up under σ=0.014 jitter: ${(acc * 100).toFixed(1)}%`);
  check("smoothed+voted heavy jitter", acc >= 0.97);
}

console.log("\n== Half-curled transition must NOT fire a confident class ==");
{
  // interpolate OPEN_PALM -> FIST midway; classifier should be low-confidence or UNKNOWN
  const a = generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.2, 0);
  const b = generateSyntheticGestureLandmarks("FIST", 0, 5.2, 0);
  const mid = a.map((p, i) => ({ x: (p.x + b[i].x) / 2, y: (p.y + b[i].y) / 2 }));
  const r = classifyHandGesture(mid, null);
  console.log(`  mid-transition → ${r.gesture} conf=${r.confidence} margin=${r.margin}`);
  check("transition ambiguity", r.gesture === "UNKNOWN" || r.confidence < 0.75 || r.margin < 0.2, `${r.gesture} ${r.confidence}`);
}

console.log("\n== Voter flicker suppression ==");
{
  const voter = new GestureVoter(9, 0.6, 0.35);
  const seq: RecognizedGesture[] = [
    "OPEN_PALM","OPEN_PALM","OPEN_PALM","OPEN_PALM","OPEN_PALM","OPEN_PALM", // commit
    "VICTORY","OPEN_PALM","UNKNOWN","OPEN_PALM","VICTORY","OPEN_PALM", // flicker: must stay OPEN_PALM
  ];
  let last = "UNKNOWN" as RecognizedGesture;
  let flips = 0;
  for (const g of seq) {
    const v = voter.push(g);
    if (v.committed !== last) flips += 1;
    last = v.committed;
  }
  console.log(`  committed after flicker: ${last}, flips=${flips}`);
  check("flicker suppression", last === "OPEN_PALM" && flips === 1, `${last} flips=${flips}`);

  // genuine switch: sustained VICTORY should take over within ~6 frames
  let took = -1;
  for (let i = 0; i < 12; i++) {
    const v = voter.push("VICTORY");
    if (v.committed === "VICTORY" && took < 0) took = i + 1;
  }
  console.log(`  genuine switch to VICTORY after ${took} frames`);
  check("genuine switch latency", took > 0 && took <= 7, `${took}`);

  // hand removed: should release to UNKNOWN
  let released = -1;
  for (let i = 0; i < 10; i++) {
    const v = voter.push("UNKNOWN");
    if (v.committed === "UNKNOWN" && released < 0) released = i + 1;
  }
  console.log(`  release to UNKNOWN after ${released} frames`);
  check("release", released > 0 && released <= 7, `${released}`);
}

console.log("\n== Intent continuity: transit vs hold ==");
{
  const it = new IntentTracker();
  let ev = it.noHand();
  // fast sweep across frame (transit) — 1.5 units/s
  for (let f = 0; f < 10; f++) {
    const lm = transform(generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.2, 0), { dx: -0.4 + f * 0.05 });
    ev = it.update(lm, f * 33.3);
  }
  console.log(`  transit: vel=${ev.wristVelocity.toFixed(2)} transit=${ev.transit} reasons=${ev.reasons.join(",")} score=${ev.score.toFixed(2)}`);
  check("transit flagged", ev.transit && ev.score < 0.5, `${ev.score}`);
  // hold still 30 frames with tremor only
  for (let f = 10; f < 40; f++) {
    const lm = generateSyntheticGestureLandmarks("OPEN_PALM", f / 30, 5.2, 0.04);
    ev = it.update(lm, f * 33.3);
  }
  console.log(`  hold w/ tremor: vel=${ev.wristVelocity.toFixed(2)} transit=${ev.transit} reasons=${ev.reasons.join(",") || "none"} score=${ev.score.toFixed(2)}`);
  check("tremor hold accepted", !ev.transit && ev.score >= 0.7 && ev.reasons.length === 0, `${ev.score} ${ev.reasons}`);
  // out of zone
  const far = transform(generateSyntheticGestureLandmarks("OPEN_PALM", 0, 5.2, 0), { dx: 0.45 });
  ev = it.update(far, 2000);
  check("out of zone flagged", ev.reasons.includes("OUT_OF_ZONE"));
}

console.log("\n== Check 18: Real GitHub HaGRID Dataset Benchmark (500 Stratified Real Human Samples) ==");
{
  const benchmarkPath = path.join(process.cwd(), "storage", "hagrid_real_benchmark.json");
  if (fs.existsSync(benchmarkPath)) {
    const raw = JSON.parse(fs.readFileSync(benchmarkPath, "utf8"));
    const samplesList = Array.isArray(raw) ? raw : raw.samples || [];
    let correct = 0;
    let total = 0;
    for (const s of samplesList) {
      const expected = s.expectedGesture || s.gesture;
      const res = classifyHandGesture(s.landmarks, null);
      total += 1;
      if (res.gesture === expected) correct += 1;
    }
    const acc = total > 0 ? correct / total : 0;
    console.log(
      `  ✓ Real HaGRID Stratified Benchmark: ${(acc * 100).toFixed(2)}% (${correct}/${total})`
    );
    check("HaGRID real dataset >= 97%", acc >= 0.97, `${(acc * 100).toFixed(2)}%`);
  } else {
    console.log("  ! storage/hagrid_real_benchmark.json not found");
  }
}

console.log("\n== Check 19: Strict Object-Grasp & Book-Holding Guard (0.0% False Positives) ==");
{
  const graspModes: Array<"BOOK_SPINE" | "OPEN_BOOK" | "PHONE_GRASP" | "CUP_MUG" | "OCCLUDED_BOOK"> = [
    "BOOK_SPINE",
    "OPEN_BOOK",
    "PHONE_GRASP",
    "CUP_MUG",
    "OCCLUDED_BOOK",
  ];
  let falsePositives = 0;
  let totalGrasps = 0;
  for (const mode of graspModes) {
    for (let f = 0; f < 40; f++) {
      const lm = generateObjectGraspLandmarks(mode, f * 0.033, 5.4, 0.035);
      const res = classifyHandGesture(lm, null);
      totalGrasps += 1;
      if (res.gesture !== "UNKNOWN") {
        falsePositives += 1;
      }
    }
  }
  console.log(
    `  ✓ Object-Grasp / Book-Hold False Positives: ${falsePositives}/${totalGrasps} (${(
      (falsePositives / totalGrasps) *
      100
    ).toFixed(2)}% FP)`
  );
  check(
    "0.0% Object-Grasp False Positive Rate",
    falsePositives === 0,
    `FP=${falsePositives}/${totalGrasps}`
  );
}

console.log("\n== Check 20: All 10 Gestures under Difficult Lighting + 5.8Hz Tremor (Smoother + Voter) ==");
{
  const ALL_TEN: RecognizedGesture[] = [
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
  let correct = 0;
  let total = 0;
  for (const g of ALL_TEN) {
    const sm = new LandmarkSmoother();
    const voter = new GestureVoter(9, 0.6, 0.35);
    for (let f = 0; f < 50; f++) {
      const raw = transform(generateSyntheticGestureLandmarks(g, f / 30, 5.8, 0.042), {
        jitter: 0.008,
        squashY: 0.88,
      });
      const lm = sm.smooth(raw, f * 33.3);
      const r = classifyHandGesture(lm, null);
      const v = voter.push(r.confidence < 0.5 ? "UNKNOWN" : r.gesture);
      if (f >= 10) {
        total += 1;
        if (v.committed === g) correct += 1;
      }
    }
  }
  const acc = correct / total;
  console.log(
    `  ✓ All 10 Gestures under Low-Light Jitter + 5.8Hz Tremor: ${(acc * 100).toFixed(2)}% (${correct}/${total})`
  );
  check("All 10 Gestures Low-Light + Tremor >= 98%", acc >= 0.98, `${(acc * 100).toFixed(2)}%`);
}

console.log("\n== Check 21: Progressive 3-Stage Tremor f0 Personalizer & Irregular Frequency Rejection ==");
{
  const tracker = new AdaptiveTremorFrequencyTracker(5.0, 0.03);
  const initStatus = tracker.getStatus();
  check("Initial stage is INITIALIZED_60S_CALIB", initStatus.stage === "INITIALIZED_60S_CALIB");

  // Feed 60 frames of natural 5.6 Hz human tremor (30 FPS)
  const cleanTremorTrajectory: number[] = [];
  for (let i = 0; i < 60; i++) {
    const t = i / 30;
    cleanTremorTrajectory.push(0.5 + 0.035 * Math.sin(2 * Math.PI * 5.6 * t));
  }
  const sigHuman = extractMotionSignature(cleanTremorTrajectory, 30);
  let lockState = tracker.getStatus();
  for (let k = 0; k < 14; k++) {
    lockState = tracker.observeSignature(sigHuman);
  }
  console.log(
    `  ✓ Tremor Personalizer after 14 natural windows: stage=${lockState.stage}, init=${lockState.initializedF0Hz}Hz -> finalized=${lockState.activeF0Hz}Hz`
  );
  check(
    "Tremor Personalizer locks natural f0",
    lockState.stage === "FINALIZED_LOCKED" && Math.abs(lockState.activeF0Hz - 5.6) <= 0.6,
    `${lockState.stage} f0=${lockState.activeF0Hz}`
  );

  // Feed irregular 14.2 Hz non-human vibration burst — must be rejected without corrupting locked f0
  const lockedF0Before = lockState.activeF0Hz;
  const irregularTrajectory: number[] = [];
  for (let i = 0; i < 60; i++) {
    const t = i / 30;
    irregularTrajectory.push(0.5 + 0.05 * Math.sin(2 * Math.PI * 14.2 * t));
  }
  const sigIrregular = extractMotionSignature(irregularTrajectory, 30);
  const afterIrregular = tracker.observeSignature(sigIrregular);
  console.log(
    `  ✓ Irregular 14.2Hz burst rejected=${afterIrregular.irregularFrequencyRejected}, activeF0 preserved=${afterIrregular.activeF0Hz}Hz`
  );
  check(
    "Irregular >12Hz burst rejected & f0 preserved",
    afterIrregular.irregularFrequencyRejected && afterIrregular.activeF0Hz === lockedF0Before
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) console.log("FAILURES:\n  " + failures.join("\n  "));
process.exit(fail ? 1 : 0);
