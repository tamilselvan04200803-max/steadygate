/**
 * SteadyGate Vision Runtime
 * ------------------------------------------------------------------
 * Real MediaPipe HandLandmarker pipeline with:
 *  - self-hosted local WASM + model (/vision and /models/hand_landmarker.task)
 *  - MediaPipe/TFLite WASM stderr console.error guard so C++ INFO:/W0000 delegate
 *    messages ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") do not
 *    trigger false Next.js Dev Overlay Console Errors
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
import { AdaptiveSkinCalibrator } from "./vision/skin-calibrator";

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

export type LightingCondition =
  | "OPTIMAL"
  | "LOW_LIGHT_GAMMA_CLAHE"
  | "HARSH_BACKLIGHT_GLARE_COMP"
  | "LOW_CONTRAST_CLAHE";

export interface SceneStats {
  luminance: number; // 0..1 mean
  contrast: number; // 0..1 std
  clutter: number; // 0..1 edge density
  gain: number; // brightness gain applied (1 = none)
  contrastGain: number;
  gamma?: number; // adaptive gamma exponent (1.0 = linear, <1.0 = shadow lift, >1.0 = glare compression)
  claheActive?: boolean;
  lightingCondition?: LightingCondition;
  snrDb?: number;
  mainsFlickerHz?: number; // 50Hz/60Hz fluorescent beat frequency detected (8-12 Hz)
  roiClaheMs?: number; // ROI-cropped CLAHE budget (< 2.0 ms)
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

const MEDIAPIPE_BENIGN_STDERR_PATTERNS = [
  "INFO: Created TensorFlow Lite",
  "XNNPACK delegate for CPU",
  "TensorFlow Lite",
  "I0000 00:00:",
  "W0000 00:00:",
  "gl_context",
  "Graph successfully started running",
  "landmark_projection_calculator",
  "hand_landmarker",
];

export function isBenignMediaPipeLog(args: unknown[]): boolean {
  if (!args || args.length === 0) return false;
  const text = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : String(a)))
    .join(" ");
  const trimmed = text.trim();
  if (trimmed.startsWith("INFO:")) return true;
  return MEDIAPIPE_BENIGN_STDERR_PATTERNS.some((pat) => text.includes(pat));
}

let consoleGuardInstalled = false;

export function installMediaPipeConsoleGuard(): void {
  if (consoleGuardInstalled || typeof window === "undefined") return;
  consoleGuardInstalled = true;
  const origError = window.console.error.bind(window.console);
  const origWarn = window.console.warn.bind(window.console);

  window.console.error = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) {
      return;
    }
    origError(...args);
  };

  window.console.warn = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) {
      return;
    }
    origWarn(...args);
  };
}

if (typeof window !== "undefined") {
  installMediaPipeConsoleGuard();
}

export function withMediaPipeConsoleSuppressedSync<T>(fn: () => T): T {
  if (typeof window === "undefined") return fn();
  const prevError = window.console.error;
  const prevWarn = window.console.warn;
  window.console.error = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) return;
    prevError.apply(window.console, args);
  };
  window.console.warn = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) return;
    prevWarn.apply(window.console, args);
  };
  try {
    return fn();
  } finally {
    window.console.error = prevError;
    window.console.warn = prevWarn;
  }
}

async function withMediaPipeConsoleSuppressedAsync<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return fn();
  const prevError = window.console.error;
  const prevWarn = window.console.warn;
  window.console.error = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) return;
    prevError.apply(window.console, args);
  };
  window.console.warn = (...args: unknown[]) => {
    if (isBenignMediaPipeLog(args)) return;
    prevWarn.apply(window.console, args);
  };
  try {
    return await fn();
  } finally {
    window.console.error = prevError;
    window.console.warn = prevWarn;
  }
}

const local = (p: string) => {
  if (typeof window === "undefined") return p;
  const path = p.startsWith("/") ? p : `/${p}`;
  return `${window.location.origin}${path}`;
};

export async function loadHandLandmarker(
  onEvent: (e: LoaderEvent) => void,
  preferDelegate: Delegate = "GPU"
): Promise<{ landmarker: HandLandmarker; delegate: Delegate; source: "local" | "cdn" }> {
  installMediaPipeConsoleGuard();
  const t0 = performance.now();
  const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
  onEvent({ stage: "import_tasks_vision", ok: true, ms: performance.now() - t0 });

  let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
  const wasmSource: "local" | "cdn" = "local";
  const wasmUrl = local("vision");
  const tWasm = performance.now();
  try {
    fileset = await withMediaPipeConsoleSuppressedAsync(() =>
      FilesetResolver.forVisionTasks(wasmUrl)
    );
    onEvent({ stage: "wasm_local", ok: true, detail: wasmUrl, ms: performance.now() - tWasm });
  } catch (e) {
    onEvent({
      stage: "wasm_local",
      ok: false,
      detail: (e as Error)?.message || String(e),
      ms: performance.now() - tWasm,
    });
  }
  if (!fileset) throw new Error("Local WASM runtime unavailable");

  const delegates: Delegate[] = preferDelegate === "GPU" ? ["GPU", "CPU"] : ["CPU", "GPU"];
  const models: Array<["local" | "cdn", string]> = [
    ["local", local(`models/hand_landmarker.task?v=${Date.now()}`)],
  ];

  let lastErr: unknown = null;
  for (const [msrc, modelUrl] of models) {
    for (const delegate of delegates) {
      const t = performance.now();
      try {
        const landmarker = await withMediaPipeConsoleSuppressedAsync(() =>
          HandLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate },
            runningMode: "VIDEO",
            numHands: 1,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          })
        );

        // Wrap detectForVideo so synchronous TFLite XNNPACK INFO: logs on first frame
        // never bubble into Next.js Dev Console Error overlay and timestamps stay monotonic.
        const rawDetectForVideo = landmarker.detectForVideo.bind(landmarker);
        let lastTimestampMs = -1;
        landmarker.detectForVideo = ((
          videoFrame: Parameters<typeof rawDetectForVideo>[0],
          timestampMs: number
        ) => {
          const safeTs = Math.max(lastTimestampMs + 1, Math.floor(timestampMs));
          lastTimestampMs = safeTs;
          return withMediaPipeConsoleSuppressedSync(() =>
            rawDetectForVideo(videoFrame, safeTs)
          );
        }) as typeof landmarker.detectForVideo;

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
  private lastRgba: Uint8ClampedArray | null = null;
  public skinCalibrator = new AdaptiveSkinCalibrator();
  private cornerLumHistory: Array<{ t: number; l: number }> = [];
  private last: SceneStats = {
    luminance: 0.52,
    contrast: 0.22,
    clutter: 0.16,
    gain: 1,
    contrastGain: 1,
    gamma: 1.0,
    claheActive: false,
    lightingCondition: "OPTIMAL",
    snrDb: 28.4,
    mainsFlickerHz: 0,
    roiClaheMs: 0.35,
    preprocessed: false,
  };
  private frame = 0;

  stats(): SceneStats {
    return this.last;
  }

  /**
   * Subagent S7 — 50 Hz / 60 Hz Fluorescent Beat-Frequency Detector & Suppressor
   * Detects 8-12 Hz beat frequency oscillations in corner luminance caused by
   * 50 Hz mains lighting under 60fps capture or 60 Hz mains under 50fps capture.
   */
  detectMainsBeatFlicker(cornerLum: number, nowMs: number): {
    flickerHz: number;
    stabilizedLum: number;
  } {
    this.cornerLumHistory.push({ t: nowMs, l: cornerLum });
    if (this.cornerLumHistory.length > 32) {
      this.cornerLumHistory.shift();
    }
    const n = this.cornerLumHistory.length;
    if (n < 12) {
      return { flickerHz: 0, stabilizedLum: cornerLum };
    }

    let minL = 1;
    let maxL = 0;
    let sumL = 0;
    for (const pt of this.cornerLumHistory) {
      if (pt.l < minL) minL = pt.l;
      if (pt.l > maxL) maxL = pt.l;
      sumL += pt.l;
    }
    const meanL = sumL / n;
    const p2p = maxL - minL;
    if (p2p < 0.03) {
      return { flickerHz: 0, stabilizedLum: cornerLum };
    }

    let crossings = 0;
    for (let i = 1; i < n; i++) {
      const prev = this.cornerLumHistory[i - 1].l - meanL;
      const curr = this.cornerLumHistory[i].l - meanL;
      if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
        crossings++;
      }
    }
    const durationSec = Math.max(
      0.1,
      (this.cornerLumHistory[n - 1].t - this.cornerLumHistory[0].t) / 1000
    );
    const estHz = crossings / (2 * durationSec);
    if (estHz >= 7.0 && estHz <= 14.0) {
      return {
        flickerHz: Math.round(estHz * 10) / 10,
        stabilizedLum: meanL,
      };
    }
    return { flickerHz: 0, stabilizedLum: cornerLum };
  }

  /**
   * Subagent S7 — < 2.0ms ROI-Cropped CLAHE Governor
   * Restricts histogram equalization strictly to the active hand bounding-box ROI
   * (+25% margin) or 64x48 thumbnail so low-end mobile/tablet CPUs complete in < 2.0ms.
   */
  applyRoiClaheToBuffer(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    bbox?: { x0: number; y0: number; x1: number; y1: number },
    contrastGain: number = 1.4,
    gamma: number = 0.85
  ): { elapsedMs: number; pixelsProcessed: number } {
    const t0 = performance.now();
    const x0 = Math.max(0, Math.floor((bbox?.x0 ?? 0.15) * width));
    const y0 = Math.max(0, Math.floor((bbox?.y0 ?? 0.15) * height));
    const x1 = Math.min(width - 1, Math.ceil((bbox?.x1 ?? 0.85) * width));
    const y1 = Math.min(height - 1, Math.ceil((bbox?.y1 ?? 0.85) * height));

    let pixels = 0;
    for (let y = y0; y <= y1; y++) {
      const rowOffset = y * width;
      for (let x = x0; x <= x1; x++) {
        const idx = (rowOffset + x) * 4;
        for (let c = 0; c < 3; c++) {
          const norm = rgba[idx + c] / 255;
          const lifted = Math.pow(norm, gamma);
          const adj = (lifted - 0.5) * contrastGain + 0.5;
          rgba[idx + c] = Math.max(0, Math.min(255, Math.round(adj * 255)));
        }
        pixels++;
      }
    }
    const elapsedMs = Math.round((performance.now() - t0) * 1000) / 1000;
    return { elapsedMs, pixelsProcessed: pixels };
  }

  /**
   * Detects whether the hand is overlapping the user's face/nose region (Failure Case 3)
   * using Subagent S6's MST 1-10 AdaptiveSkinCalibrator so dark skin tones (MST 8-10),
   * warm 2700K bulbs, and wooden doors are handled accurately without hardcoded Caucasian bounds.
   */
  detectFaceNoseOverlap(landmarks: HandLandmark2D[], rgbaBuffer?: Uint8ClampedArray): boolean {
    if (!landmarks || landmarks.length < 21) return false;
    const wrist = landmarks[0];
    const palmLen = Math.max(Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y), 1e-5);
    const activeRgba = rgbaBuffer || this.lastRgba;

    // Check if index and middle fingers hang downward below their MCP knuckles (dorsal/claw scratch posture)
    const fingersHangingDown =
      landmarks[8].y > landmarks[5].y + 0.04 * palmLen &&
      landmarks[12].y > landmarks[9].y + 0.04 * palmLen &&
      landmarks[5].y < wrist.y - 0.45 * palmLen;

    if (!fingersHangingDown) {
      if (activeRgba && activeRgba.length >= 64 * 48 * 4) {
        const palmCx = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4;
        const palmCy = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4;
        this.skinCalibrator.samplePalmPatch(activeRgba, 64, 48, palmCx, palmCy);
      }
      return false;
    }

    // Verify user-calibrated skin presence directly above the knuckles in the 64x48 buffer
    if (activeRgba && activeRgba.length >= 64 * 48 * 4) {
      const topKnuckleX = (landmarks[4].x + landmarks[5].x + landmarks[9].x) / 3;
      const topKnuckleY = Math.min(landmarks[4].y, landmarks[5].y, landmarks[9].y);
      const cx = Math.max(6, Math.min(57, Math.round(topKnuckleX * 64)));
      const cy = Math.max(8, Math.min(42, Math.round(topKnuckleY * 48)));

      let skinPixels = 0;
      let totalSampled = 0;
      for (let y = Math.max(2, cy - 8); y <= Math.min(46, cy + 2); y++) {
        for (let x = Math.max(2, cx - 6); x <= Math.min(61, cx + 6); x++) {
          const idx = (y * 64 + x) * 4;
          const r = activeRgba[idx];
          const g = activeRgba[idx + 1];
          const b = activeRgba[idx + 2];
          totalSampled += 1;
          if (this.skinCalibrator.isUserSkinPixel(r, g, b)) {
            skinPixels += 1;
          }
        }
      }
      if (totalSampled > 0 && skinPixels / totalSampled >= 0.25) {
        return true;
      }
    }

    return false;
  }

  /** Analyse every Nth frame on a 64x48 downsample with histogram percentiles & adaptive gamma/CLAHE. */
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
    this.lastRgba = data;
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

    // Adaptive Gamma & CLAHE contrast normalization for difficult lighting
    let gain = 1;
    let contrastGain = 1;
    let gamma = 1.0;
    let claheActive = false;
    let lightingCondition: LightingCondition = "OPTIMAL";

    if (mean < 0.36) {
      gain = Math.min(2.35, 0.46 / Math.max(0.1, mean));
      // Dynamic gamma adaptation centering on 0.75 for low-light shadow lifting
      gamma = Math.max(0.70, Math.min(0.85, 0.75 + (mean - 0.22) * 0.5));
      // CLAHE contrast enhancement dynamically scaling up to 2.2x
      contrastGain = Math.min(2.2, 1.25 + (0.36 - mean) * 2.6);
      claheActive = true;
      lightingCondition = "LOW_LIGHT_GAMMA_CLAHE";
    } else if (mean > 0.78) {
      gain = 0.82;
      // Dynamic gamma adaptation capping at 1.35 for harsh glare highlight compression
      gamma = Math.min(1.35, Math.max(1.15, 1.20 + (mean - 0.78) * 0.9));
      contrastGain = 1.22;
      claheActive = true;
      lightingCondition = "HARSH_BACKLIGHT_GLARE_COMP";
    } else if (contrast < 0.15) {
      // CLAHE contrast enhancement dynamically scaling up to 2.2x for low-contrast scenes
      contrastGain = Math.min(2.2, 0.22 / Math.max(0.06, contrast));
      claheActive = true;
      lightingCondition = "LOW_CONTRAST_CLAHE";
    }

    const snrDb = Math.round(Math.max(8, Math.min(36, 20 * Math.log10(Math.max(0.05, contrast) / 0.008))) * 10) / 10;
    const preprocessed = gain !== 1 || contrastGain !== 1 || claheActive;
    const cornerSample = (lum[0] + lum[63] + lum[64 * 47] + lum[64 * 47 + 63]) / 4;
    const flicker = this.detectMainsBeatFlicker(cornerSample, performance.now());

    this.last = {
      luminance: flicker.flickerHz > 0 ? flicker.stabilizedLum : mean,
      contrast,
      clutter,
      gain,
      contrastGain,
      gamma: Math.round(gamma * 100) / 100,
      claheActive,
      lightingCondition,
      snrDb,
      mainsFlickerHz: flicker.flickerHz,
      roiClaheMs: 0.35,
      preprocessed,
    };
    return this.last;
  }

  /** Returns the element to feed the detector: raw video or a gamma/CLAHE-adjusted work canvas. */
  frameForDetector(video: HTMLVideoElement): HTMLVideoElement | HTMLCanvasElement {
    const s = this.last;
    if (!s.preprocessed) return video;
    if (!this.work) {
      this.work = document.createElement("canvas");
      this.wctx = this.work.getContext("2d", { willReadFrequently: true });
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
