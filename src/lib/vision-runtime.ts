/**
 * SteadyGate Vision Runtime
 * ------------------------------------------------------------------
 * Real MediaPipe HandLandmarker pipeline with:
 *  - self-hosted WASM + model, fallback chain (local GPU → local CPU → CDN GPU → CDN CPU)
 *  - per-frame scene analysis (luminance, contrast, clutter/edge density)
 *  - adaptive pre-processing for low light / low contrast (drawn to a work canvas
 *    with brightness/contrast gain, then fed to the detector)
 *  - landmark temporal smoothing (One-Euro-lite EMA with velocity-adaptive alpha)
 *  - gesture vote buffer with hysteresis (commit needs a majority over a window)
 *  - intent-continuity evidence (presence streak, wrist velocity, in-ROI, hand size)
 *  - telemetry reporter → /api/telemetry so backend agents can see the browser
 */

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandLandmark2D, RecognizedGesture } from "./types";

export type ModelStatus =
  | "IDLE"
  | "LOADING_WASM"
  | "LOADING_MODEL"
  | "READY"
  | "FAILED";

export type Delegate = "GPU" | "CPU";

export interface LoaderEvent {
  stage: string;
  ok: boolean;
  detail?: string;
  ms: number;
}

export interface SceneStats {
  luminance: number; // 0..1 mean
  contrast: number; // 0..1 std
  clutter: number; // 0..1 edge density
  gain: number; // brightness gain applied (1 = none)
  contrastGain: number;
  preprocessed: boolean;
}

export interface IntentEvidence {
  presenceStreakFrames: number;
  wristVelocity: number; // normalized units per second
  inRoi: boolean;
  handScale: number; // palm length normalized (bigger = closer)
  handScaleOk: boolean;
  transit: boolean; // moving too fast to be an intentional hold
  reasons: string[]; // machine-readable blockers
  score: number; // 0..1 continuity score
}

export interface VoteResult {
  committed: RecognizedGesture;
  candidate: RecognizedGesture;
  agreement: number; // fraction of window agreeing with candidate
  stableFrames: number;
}

const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const local = (p: string) => {
  if (typeof window === "undefined") return p;
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${window.location.origin}${path}`;
};

export async function loadHandLandmarker(
  onEvent: (e: LoaderEvent) => void,
  preferDelegate: Delegate = "GPU"
): Promise<{ landmarker: HandLandmarker; delegate: Delegate; source: "local" | "cdn" }> {
  const t0 = performance.now();
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  onEvent({ stage: "import_tasks_vision", ok: true, ms: performance.now() - t0 });

  let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  let wasmSource: "local" | "cdn" = "local";
  for (const [src, url] of [
    ["local", local("vision")],
    ["cdn", CDN_WASM],
  ] as const) {
    const t = performance.now();
    try {
      fileset = await FilesetResolver.forVisionTasks(url);
      wasmSource = src;
      onEvent({ stage: `wasm_${src}`, ok: true, detail: url, ms: performance.now() - t });
      break;
    } catch (e) {
      onEvent({
        stage: `wasm_${src}`,
        ok: false,
        detail: (e as Error)?.message || String(e),
        ms: performance.now() - t,
      });
    }
  }
  if (!fileset) throw new Error("WASM runtime unavailable (local + CDN failed)");

  const delegates: Delegate[] = preferDelegate === "GPU" ? ["GPU", "CPU"] : ["CPU", "GPU"];
  const models: Array<["local" | "cdn", string]> = [
    ["local", local(`models/hand_landmarker.task?v=${Date.now()}`)],
    ["cdn", CDN_MODEL],
  ];

  let lastErr: unknown = null;
  for (const [msrc, modelUrl] of models) {
    for (const delegate of delegates) {
      const t = performance.now();
      try {
        const landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.45,
          minHandPresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
        });
        onEvent({
          stage: `model_${msrc}_${delegate}`,
          ok: true,
          detail: `${modelUrl} via ${wasmSource} wasm`,
          ms: performance.now() - t,
        });
        return { landmarker, delegate, source: msrc };
      } catch (e) {
        lastErr = e;
        onEvent({
          stage: `model_${msrc}_${delegate}`,
          ok: false,
          detail: (e as Error)?.message || String(e),
          ms: performance.now() - t,
        });
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("HandLandmarker creation failed");
}

/* ------------------------------------------------------------------ */
/* Scene analysis + adaptive preprocessing                              */
/* ------------------------------------------------------------------ */

export class SceneAnalyzer {
  private small: HTMLCanvasElement | null = null;
  private sctx: CanvasRenderingContext2D | null = null;
  private work: HTMLCanvasElement | null = null;
  private wctx: CanvasRenderingContext2D | null = null;
  private last: SceneStats = {
    luminance: 0.5,
    contrast: 0.2,
    clutter: 0.2,
    gain: 1,
    contrastGain: 1,
    preprocessed: false,
  };
  private frame = 0;

  stats(): SceneStats {
    return this.last;
  }

  /** Analyse every Nth frame on a 64x48 downsample. Cheap. */
  analyse(video: HTMLVideoElement, every = 6): SceneStats {
    this.frame += 1;
    if (this.frame % every !== 0) return this.last;
    if (!this.small) {
      this.small = document.createElement("canvas");
      this.small.width = 64;
      this.small.height = 48;
      this.sctx = this.small.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.sctx;
    if (!ctx) return this.last;
    ctx.drawImage(video, 0, 0, 64, 48);
    const { data } = ctx.getImageData(0, 0, 64, 48);
    const n = 64 * 48;
    const lum = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const l = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) / 255;
      lum[i] = l;
      sum += l;
    }
    const mean = sum / n;
    let varSum = 0;
    let edges = 0;
    for (let y = 1; y < 47; y++) {
      for (let x = 1; x < 63; x++) {
        const i = y * 64 + x;
        const d = lum[i] - mean;
        varSum += d * d;
        const gx = Math.abs(lum[i + 1] - lum[i - 1]);
        const gy = Math.abs(lum[i + 64] - lum[i - 64]);
        if (gx + gy > 0.18) edges += 1;
      }
    }
    const contrast = Math.sqrt(varSum / n);
    const clutter = edges / n;

    // Adaptive gains (research: brightness normalisation in low light)
    let gain = 1;
    let contrastGain = 1;
    if (mean < 0.32) gain = Math.min(2.2, 0.42 / Math.max(0.12, mean));
    else if (mean > 0.8) gain = 0.85;
    if (contrast < 0.13) contrastGain = Math.min(1.8, 0.2 / Math.max(0.06, contrast));
    const preprocessed = gain !== 1 || contrastGain !== 1;

    this.last = { luminance: mean, contrast, clutter, gain, contrastGain, preprocessed };
    return this.last;
  }

  /** Returns the element to feed the detector: raw video or a gain-adjusted canvas. */
  frameForDetector(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
    const s = this.last;
    if (!s.preprocessed) return video;
    if (!this.work) {
      this.work = document.createElement("canvas");
      this.wctx = this.work.getContext("2d");
    }
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    if (this.work.width !== w || this.work.height !== h) {
      this.work.width = w;
      this.work.height = h;
    }
    const ctx = this.wctx;
    if (!ctx) return video;
    ctx.filter = `brightness(${s.gain.toFixed(2)}) contrast(${s.contrastGain.toFixed(2)})`;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";
    return this.work;
  }

  /** Scene quality in [0,1] used by the intent gate — measured, not a slider. */
  quality(detectRate: number): number {
    const s = this.last;
    const lumScore = 1 - Math.min(1, Math.abs(s.luminance - 0.5) / 0.45);
    const conScore = Math.min(1, s.contrast / 0.22);
    const clutScore = 1 - Math.min(1, Math.max(0, s.clutter - 0.22) / 0.3);
    const q = 0.35 * lumScore + 0.25 * conScore + 0.15 * clutScore + 0.25 * detectRate;
    return Math.max(0.05, Math.min(1, q));
  }
}

/* ------------------------------------------------------------------ */
/* Landmark smoothing (One-Euro-lite)                                   */
/* ------------------------------------------------------------------ */

export class LandmarkSmoother {
  private prev: HandLandmark2D[] | null = null;
  private prevT = 0;

  reset() {
    this.prev = null;
  }

  smooth(lm: HandLandmark2D[], now: number): HandLandmark2D[] {
    if (!this.prev || this.prev.length !== lm.length) {
      this.prev = lm.map((p) => ({ ...p }));
      this.prevT = now;
      return this.prev;
    }
    const dt = Math.max(1, now - this.prevT) / 1000;
    this.prevT = now;
    const out: HandLandmark2D[] = new Array(lm.length);
    for (let i = 0; i < lm.length; i++) {
      const p = this.prev[i];
      const v = Math.hypot(lm[i].x - p.x, lm[i].y - p.y) / dt; // units/s
      // fast motion → trust new sample more (less lag); slow → smooth jitter
      const alpha = Math.min(0.95, Math.max(0.25, 0.25 + v * 0.9));
      out[i] = {
        x: p.x + alpha * (lm[i].x - p.x),
        y: p.y + alpha * (lm[i].y - p.y),
        z: lm[i].z,
      };
    }
    this.prev = out;
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Gesture vote buffer with hysteresis                                  */
/* ------------------------------------------------------------------ */

export class GestureVoter {
  private window: RecognizedGesture[] = [];
  private committed: RecognizedGesture = "UNKNOWN";
  private stable = 0;
  constructor(private size = 9, private commitFrac = 0.6, private releaseFrac = 0.35) {}

  reset() {
    this.window = [];
    this.committed = "UNKNOWN";
    this.stable = 0;
  }

  push(g: RecognizedGesture): VoteResult {
    this.window.push(g);
    if (this.window.length > this.size) this.window.shift();
    const counts = new Map<RecognizedGesture, number>();
    for (const x of this.window) counts.set(x, (counts.get(x) || 0) + 1);
    let candidate: RecognizedGesture = "UNKNOWN";
    let best = 0;
    for (const [k, v] of counts) {
      if (v > best) {
        best = v;
        candidate = k;
      }
    }
    const agreement = best / this.window.length;
    const currentFrac = (counts.get(this.committed) || 0) / this.window.length;

    if (this.committed === "UNKNOWN") {
      if (agreement >= this.commitFrac && candidate !== "UNKNOWN") {
        this.committed = candidate;
        this.stable = 1;
      }
    } else if (candidate !== this.committed && agreement >= this.commitFrac) {
      this.committed = candidate;
      this.stable = 1;
    } else if (currentFrac < this.releaseFrac) {
      this.committed = "UNKNOWN";
      this.stable = 0;
    } else {
      this.stable += 1;
    }
    return { committed: this.committed, candidate, agreement, stableFrames: this.stable };
  }
}

/* ------------------------------------------------------------------ */
/* Intent continuity                                                    */
/* ------------------------------------------------------------------ */

export class IntentTracker {
  private streak = 0;
  private lastWrist: { x: number; y: number; t: number } | null = null;
  private velEma = 0;
  /**
   * Tremor-robust translation velocity: compare the centroid of the last ~0.4 s
   * of wrist positions against the previous ~0.4 s. A 4–12 Hz oscillation
   * averages to ~0 over the window; a deliberate sweep does not.
   */
  private ring: Array<{ x: number; y: number; t: number }> = [];
  private static WIN = 12;

  reset() {
    this.streak = 0;
    this.lastWrist = null;
    this.velEma = 0;
    this.ring = [];
  }

  private centroidVelocity(): number {
    const W = IntentTracker.WIN;
    if (this.ring.length < W * 2) return 0;
    const a = this.ring.slice(-W * 2, -W);
    const b = this.ring.slice(-W);
    const ca = a.reduce((s, p) => ({ x: s.x + p.x / W, y: s.y + p.y / W, t: s.t + p.t / W }), { x: 0, y: 0, t: 0 });
    const cb = b.reduce((s, p) => ({ x: s.x + p.x / W, y: s.y + p.y / W, t: s.t + p.t / W }), { x: 0, y: 0, t: 0 });
    const dt = Math.max(1, cb.t - ca.t) / 1000;
    return Math.hypot(cb.x - ca.x, cb.y - ca.y) / dt;
  }

  noHand(): IntentEvidence {
    this.streak = 0;
    this.lastWrist = null;
    return {
      presenceStreakFrames: 0,
      wristVelocity: 0,
      inRoi: false,
      handScale: 0,
      handScaleOk: false,
      transit: false,
      reasons: ["NO_HAND"],
      score: 0,
    };
  }

  update(lm: HandLandmark2D[], now: number): IntentEvidence {
    this.streak += 1;
    const wrist = lm[0];
    const midMcp = lm[9];
    const handScale = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y);
    this.ring.push({ x: wrist.x, y: wrist.y, t: now });
    if (this.ring.length > IntentTracker.WIN * 2) this.ring.shift();
    let vel: number;
    if (this.ring.length >= IntentTracker.WIN * 2) {
      vel = this.centroidVelocity();
    } else if (this.ring.length >= 4) {
      // warm-up: net displacement first→last. Tremor nets ≈ 0; a sweep does not.
      const f = this.ring[0];
      const dt = Math.max(1, now - f.t) / 1000;
      vel = Math.hypot(wrist.x - f.x, wrist.y - f.y) / dt;
    } else vel = 0;
    this.lastWrist = { x: wrist.x, y: wrist.y, t: now };
    this.velEma = this.velEma * 0.6 + vel * 0.4;

    const cx = midMcp.x;
    const cy = midMcp.y;
    const inRoi = cx > 0.12 && cx < 0.88 && cy > 0.1 && cy < 0.92;
    const handScaleOk = handScale > 0.07 && handScale < 0.5;
    const transit = this.velEma > 0.9;

    const reasons: string[] = [];
    if (!inRoi) reasons.push("OUT_OF_ZONE");
    if (handScale <= 0.07) reasons.push("HAND_TOO_FAR");
    if (handScale >= 0.5) reasons.push("HAND_TOO_CLOSE");
    if (transit) reasons.push("HAND_IN_TRANSIT");
    if (this.streak < 6) reasons.push("PRESENCE_TOO_SHORT");

    const streakScore = Math.min(1, this.streak / 20);
    const velScore = 1 - Math.min(1, this.velEma / 1.2);
    const score =
      (inRoi ? 1 : 0.3) * (handScaleOk ? 1 : 0.4) * (0.5 + 0.5 * streakScore) * (0.4 + 0.6 * velScore);

    return {
      presenceStreakFrames: this.streak,
      wristVelocity: this.velEma,
      inRoi,
      handScale,
      handScaleOk,
      transit,
      reasons,
      score: Math.max(0, Math.min(1, score)),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Telemetry reporter                                                   */
/* ------------------------------------------------------------------ */

export interface VisionTelemetry {
  sessionId: string;
  mode: "SIMULATED" | "WEBCAM";
  modelStatus: ModelStatus;
  delegate: Delegate | null;
  modelSource: "local" | "cdn" | null;
  loaderEvents: LoaderEvent[];
  fps: number;
  framesTotal: number;
  framesWithHand: number;
  detectRate: number;
  scene: SceneStats;
  vote: VoteResult | null;
  intent: IntentEvidence | null;
  classifier: { gesture: RecognizedGesture; confidence: number; margin: number } | null;
  cameraError: string | null;
  jsErrors: Array<{ message: string; source?: string; ts: number }>;
  userAgent: string;
  ts: number;
}

export function makeSessionId(): string {
  const key = "sg.session";
  try {
    const cur = sessionStorage.getItem(key);
    if (cur) return cur;
    const id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `sess_${Date.now().toString(36)}`;
  }
}

export class ErrorCollector {
  private buf: Array<{ message: string; source?: string; ts: number }> = [];
  private bound = false;
  attach() {
    if (this.bound || typeof window === "undefined") return;
    this.bound = true;
    window.addEventListener("error", (e) => {
      this.buf.push({ message: e.message, source: e.filename, ts: Date.now() });
      if (this.buf.length > 20) this.buf.shift();
    });
    window.addEventListener("unhandledrejection", (e) => {
      const r = e.reason as { message?: string };
      this.buf.push({ message: r?.message || String(e.reason), source: "promise", ts: Date.now() });
      if (this.buf.length > 20) this.buf.shift();
    });
  }
  push(message: string, source?: string) {
    this.buf.push({ message, source, ts: Date.now() });
    if (this.buf.length > 20) this.buf.shift();
  }
  drain() {
    const out = [...this.buf];
    this.buf = [];
    return out;
  }
}

export async function postTelemetry(t: VisionTelemetry): Promise<void> {
  try {
    await fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: t.sessionId, source: "vision", payload: t }),
      keepalive: true,
    });
  } catch {
    /* telemetry must never break the pipeline */
  }
}

export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
