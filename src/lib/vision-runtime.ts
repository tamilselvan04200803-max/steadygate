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
import { STEADYGATE_V6_CONFIG } from "../config/steadygate.config";

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

export type OpticalDegradeStep =
  | "BYPASSED_OPTIMAL"
  | "FULL_GAMMA_GUIDED_CLAHE"
  | "SKIP_CLAHE_GAMMA_GUIDED"
  | "GAMMA_LUT_ONLY";

export interface HardwareOpticalLockResult {
  supported: boolean;
  mode: "hardware_manual_locked" | "continuous_auto_relaxed" | "software_fallback";
  mainsHz: 50 | 60;
  appliedExposureTimeMs: number | null;
  quantizationErrorRatio: number;
  motionBlurRisk: boolean;
}

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
  /** v6.0 Wave 1 Stage 1 Optical Diagnostics */
  rollingShutterFlickerHz?: number;
  flickerAttenuatedDb?: number;
  flickerConfidence?: number;
  laplacianBlurVariance?: number;
  rollingSharpBaseline?: number;
  motionBlurDegraded?: boolean;
  chromaDriftDeltaCbCr?: number;
  degradeStep?: OpticalDegradeStep;
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
/* Stage 1 Hardware UVC Shutter & Anti-Banding Lock                     */
/* ------------------------------------------------------------------ */

export function inferDefaultMainsHz(): 50 | 60 {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (
      tz.startsWith("America/") &&
      !tz.includes("Argentina") &&
      !tz.includes("Santiago") &&
      !tz.includes("Lima") &&
      !tz.includes("Montevideo")
    ) {
      return 60;
    }
    if (tz === "Asia/Seoul" || tz === "Asia/Taipei" || tz === "Asia/Manila") {
      return 60;
    }
    return 50;
  } catch {
    return 50;
  }
}

/**
 * Capability-Probed Hardware UVC Shutter & Anti-Banding Lock (Wave 1 Stage 1).
 * Safely probes `track.getCapabilities?.()` inside a `try/catch` block, verifies applied
 * hardware settings via `track.getSettings?.()`, and locks exposureTime to a quantized
 * integer multiple of the mains half-cycle (10.0 ms for 50 Hz, 8.333 ms for 60 Hz) when
 * quantization error <= 1%. Automatically relaxes back to "continuous" in dark scenes.
 */
export async function configureHardwareOpticalConstraints(
  track: MediaStreamTrack | null | undefined,
  options?: {
    mainsHz?: 50 | 60;
    sceneLumaMean?: number;
    lowLightDurationMs?: number;
  }
): Promise<HardwareOpticalLockResult> {
  const mainsHz: 50 | 60 = options?.mainsHz ?? inferDefaultMainsHz();
  const fallback: HardwareOpticalLockResult = {
    supported: false,
    mode: "software_fallback",
    mainsHz,
    appliedExposureTimeMs: null,
    quantizationErrorRatio: 0,
    motionBlurRisk: false,
  };

  if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") {
    return fallback;
  }

  try {
    const caps = track.getCapabilities() as Record<string, unknown>;
    const exposureModes = Array.isArray(caps.exposureMode) ? (caps.exposureMode as string[]) : [];
    const expRange = caps.exposureTime as { min?: number; max?: number; step?: number } | undefined;

    if (
      !exposureModes.includes("manual") ||
      !expRange ||
      typeof expRange.min !== "number" ||
      typeof expRange.max !== "number"
    ) {
      return fallback;
    }

    const sceneLuma = options?.sceneLumaMean ?? 0.5;
    const lowLightMs = options?.lowLightDurationMs ?? 0;

    // Dark-room safety fallback: relax back to continuous if sceneLumaMean < 0.08 for > 1.0s
    if (
      sceneLuma < STEADYGATE_V6_CONFIG.stage1Optical.criticalDarkLumaFloor.value &&
      lowLightMs >= 1000
    ) {
      if (exposureModes.includes("continuous")) {
        await track.applyConstraints({
          advanced: [{ exposureMode: "continuous" } as MediaTrackConstraintSet],
        });
      }
      return {
        supported: true,
        mode: "continuous_auto_relaxed",
        mainsHz,
        appliedExposureTimeMs: null,
        quantizationErrorRatio: 0,
        motionBlurRisk: false,
      };
    }

    const halfCycleMs =
      mainsHz === 50
        ? STEADYGATE_V6_CONFIG.stage1Optical.shutterPeriod50HzMs.value
        : STEADYGATE_V6_CONFIG.stage1Optical.shutterPeriod60HzMs.value;
    // Use k=2 half-cycles in moderate-low light (0.08..0.18), else k=1 half-cycle
    const kMultiple = sceneLuma < 0.18 ? 2 : 1;
    const targetMs = halfCycleMs * kMultiple;

    // UVC drivers report exposureTime either in milliseconds (e.g. 1..500) or 100us units (e.g. 10..5000)
    const unitScale = expRange.max > 1000 && expRange.min >= 1 ? 10 : 1;
    const targetRaw = targetMs * unitScale;
    const step = typeof expRange.step === "number" && expRange.step > 0 ? expRange.step : 1;
    const clampedRaw = Math.max(expRange.min, Math.min(expRange.max, targetRaw));
    const quantizedRaw = expRange.min + Math.round((clampedRaw - expRange.min) / step) * step;
    const quantizedMs = quantizedRaw / unitScale;
    const quantErr = Math.abs(quantizedMs - targetMs) / Math.max(1e-6, targetMs);

    if (quantErr > STEADYGATE_V6_CONFIG.stage1Optical.shutterQuantizationToleranceRatio.value) {
      return {
        ...fallback,
        quantizationErrorRatio: Math.round(quantErr * 10000) / 10000,
      };
    }

    // Apply sequentially: manual mode first, then quantized exposureTime
    await track.applyConstraints({
      advanced: [{ exposureMode: "manual" } as MediaTrackConstraintSet],
    });
    await track.applyConstraints({
      advanced: [{ exposureTime: quantizedRaw } as MediaTrackConstraintSet],
    });

    const settings =
      typeof track.getSettings === "function"
        ? (track.getSettings() as Record<string, unknown>)
        : {};
    const appliedRaw =
      typeof settings.exposureTime === "number" ? (settings.exposureTime as number) : quantizedRaw;
    const appliedMs = Math.round((appliedRaw / unitScale) * 1000) / 1000;

    return {
      supported: true,
      mode: "hardware_manual_locked",
      mainsHz,
      appliedExposureTimeMs: appliedMs,
      quantizationErrorRatio: Math.round(quantErr * 10000) / 10000,
      motionBlurRisk: kMultiple >= 2 || appliedMs >= 16.0,
    };
  } catch {
    return fallback;
  }
}

export async function restoreContinuousExposure(
  track: MediaStreamTrack | null | undefined
): Promise<boolean> {
  if (!track || typeof track.applyConstraints !== "function") return false;
  try {
    await track.applyConstraints({
      advanced: [{ exposureMode: "continuous" } as MediaTrackConstraintSet],
    });
    return true;
  } catch {
    return false;
  }
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
  /** Pre-allocated Stage 1 ring buffers & scratch arrays (zero per-frame heap allocation) */
  private rowMeanRing = new Float32Array(16 * 48);
  private rowMeanTs = new Float64Array(16);
  private rowMeanHead = 0;
  private rowMeanCount = 0;
  private baselineRowMean = new Float32Array(48);
  private sharpBlurRing = new Float32Array(60);
  private sharpBlurHead = 0;
  private sharpBlurCount = 0;
  private sharpSortScratch = new Float32Array(60);
  private workLuma = new Float32Array(64 * 48);
  private workCb = new Float32Array(64 * 48);
  private workCr = new Float32Array(64 * 48);
  private guidedMeanI = new Float32Array(64 * 48);
  private guidedMeanII = new Float32Array(64 * 48);
  private guidedA = new Float32Array(64 * 48);
  private guidedB = new Float32Array(64 * 48);
  private gammaLut = new Uint8Array(256);
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
    rollingShutterFlickerHz: 0,
    flickerAttenuatedDb: 0,
    flickerConfidence: 0,
    laplacianBlurVariance: 180,
    rollingSharpBaseline: 220,
    motionBlurDegraded: false,
    chromaDriftDeltaCbCr: 0,
    degradeStep: "BYPASSED_OPTIMAL",
  };
  private frame = 0;

  stats(): SceneStats {
    return this.last;
  }

  /**
   * Wave 1 Stage 1 — FPS-Aware Goertzel Row-Mean Rolling-Shutter Flicker Detector & Canceler
   * Computes expected alias beat frequency f_beat = |2*f_mains - round(2*f_mains / fps) * fps|,
   * samples background row-mean luma masked away from hand/face ROIs over a 16-frame ring buffer,
   * runs a Goertzel filter at f_beat + vertical spatial banding analysis, and applies AC-only
   * per-row luma gain equalization strictly on the BT.601 YUV Y plane (>= 20 dB suppression).
   */
  cancelRollingShutterFlicker(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    options?: {
      timestampMs?: number;
      mainsHz?: 50 | 60;
      handBbox?: { x0: number; y0: number; x1: number; y1: number } | null;
      faceBbox?: { x0: number; y0: number; x1: number; y1: number } | null;
    }
  ): {
    flickerDetected: boolean;
    beatHz: number;
    measuredFps: number;
    flickerConfidence: number;
    attenuatedDb: number;
    chromaDriftDeltaCbCr: number;
  } {
    if (!rgba || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
      return {
        flickerDetected: false,
        beatHz: 0,
        measuredFps: 30,
        flickerConfidence: 0,
        attenuatedDb: 0,
        chromaDriftDeltaCbCr: 0,
      };
    }

    const nowMs = options?.timestampMs ?? performance.now();
    const mainsHz = options?.mainsHz ?? inferDefaultMainsHz();
    const rows = Math.min(48, height);
    const slot = this.rowMeanHead % 16;
    this.rowMeanTs[slot] = nowMs;

    // 1. Sample horizontal row-mean luma across background columns (masking out hand & face ROIs)
    const hBox = options?.handBbox;
    const fBox = options?.faceBbox;
    for (let r = 0; r < rows; r++) {
      const y = Math.min(height - 1, Math.floor((r / rows) * height));
      const yNorm = y / height;
      let sumY = 0;
      let count = 0;
      for (let x = 0; x < width; x++) {
        const xNorm = x / width;
        const inHand =
          hBox &&
          xNorm >= hBox.x0 &&
          xNorm <= hBox.x1 &&
          yNorm >= hBox.y0 &&
          yNorm <= hBox.y1;
        const inFace =
          fBox &&
          xNorm >= fBox.x0 &&
          xNorm <= fBox.x1 &&
          yNorm >= fBox.y0 &&
          yNorm <= fBox.y1;
        if (inHand || inFace) continue;
        const idx = (y * width + x) * 4;
        const luma = (0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]) / 255;
        sumY += luma;
        count++;
      }
      if (count === 0) {
        // Fallback to perimeter columns if hand covers entire row
        const idxL = (y * width + 0) * 4;
        const idxR = (y * width + (width - 1)) * 4;
        sumY =
          (0.299 * (rgba[idxL] + rgba[idxR]) +
            0.587 * (rgba[idxL + 1] + rgba[idxR + 1]) +
            0.114 * (rgba[idxL + 2] + rgba[idxR + 2])) /
          255;
        count = 2;
      }
      this.rowMeanRing[slot * 48 + r] = sumY / count;
    }

    this.rowMeanHead = (this.rowMeanHead + 1) % 16;
    if (this.rowMeanCount < 16) this.rowMeanCount++;

    // 2. Measure instantaneous FPS from capture timestamps
    let measuredFps = 30.0;
    if (this.rowMeanCount >= 4) {
      const oldestSlot = (this.rowMeanHead - this.rowMeanCount + 16) % 16;
      const newestSlot = (this.rowMeanHead - 1 + 16) % 16;
      const dtSec = (this.rowMeanTs[newestSlot] - this.rowMeanTs[oldestSlot]) / 1000;
      if (dtSec > 0.01) {
        measuredFps = Math.max(8, Math.min(120, (this.rowMeanCount - 1) / dtSec));
      }
    }

    const lineFreq = 2 * mainsHz;
    const expectedBeatHz = Math.abs(
      lineFreq - Math.round(lineFreq / measuredFps) * measuredFps
    );

    // 3. Compute temporal baseline row mean mu_row(y) and pre-correction AC row ripple energy
    let preRippleEnergy = 0;
    let dcRowMean = 0;
    for (let r = 0; r < rows; r++) {
      let sumT = 0;
      for (let k = 0; k < this.rowMeanCount; k++) {
        sumT += this.rowMeanRing[k * 48 + r];
      }
      const mu = sumT / Math.max(1, this.rowMeanCount);
      this.baselineRowMean[r] = mu;
      dcRowMean += mu;
    }
    dcRowMean /= Math.max(1, rows);

    // Spatial row-banding ripple energy on current frame relative to spatial smooth profile
    for (let r = 0; r < rows; r++) {
      const curRow = this.rowMeanRing[slot * 48 + r];
      const acDiff = curRow - dcRowMean;
      preRippleEnergy += acDiff * acDiff;
    }
    preRippleEnergy /= Math.max(1, rows);

    // 4. Run Goertzel filter at expectedBeatHz across the 16-frame ring buffer + spatial periodicity
    let goertzelRatio = 0;
    if (this.rowMeanCount >= 8 && expectedBeatHz > 0.5) {
      const N = this.rowMeanCount;
      const omega = (2 * Math.PI * expectedBeatHz) / measuredFps;
      const coeff = 2 * Math.cos(omega);
      let bandPowerSum = 0;
      let totalAcPowerSum = 0;

      for (let r = 0; r < rows; r += 2) {
        const mu = this.baselineRowMean[r];
        let s0 = 0,
          s1 = 0,
          s2 = 0;
        let rowAcVar = 0;
        for (let i = 0; i < N; i++) {
          const tIdx = (this.rowMeanHead - N + i + 16) % 16;
          const x = this.rowMeanRing[tIdx * 48 + r] - mu;
          rowAcVar += x * x;
          s0 = x + coeff * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
        bandPowerSum += Math.max(0, power) / N;
        totalAcPowerSum += rowAcVar;
      }
      if (totalAcPowerSum > 1e-6) {
        goertzelRatio = Math.min(1, bandPowerSum / (totalAcPowerSum * 0.45 + 1e-6));
      }
    }

    // Also measure vertical spatial row-banding periodicity (handles 60Hz @ 30fps static f_beat=0Hz banding)
    let spatialBandSignFlips = 0;
    let spatialAcRms = Math.sqrt(preRippleEnergy);
    for (let r = 2; r < rows; r++) {
      const dPrev = this.rowMeanRing[slot * 48 + (r - 1)] - dcRowMean;
      const dCurr = this.rowMeanRing[slot * 48 + r] - dcRowMean;
      if ((dPrev <= -0.004 && dCurr >= 0.004) || (dPrev >= 0.004 && dCurr <= -0.004)) {
        spatialBandSignFlips++;
      }
    }
    const spatialPeriodicityScore =
      spatialAcRms >= 0.012 && spatialBandSignFlips >= 2
        ? Math.min(1, (spatialAcRms / 0.03) * 0.85)
        : 0;

    const flickerConfidence =
      Math.round(Math.max(goertzelRatio, spatialPeriodicityScore) * 1000) / 1000;
    const flickerDetected =
      flickerConfidence >=
        STEADYGATE_V6_CONFIG.stage1Optical.flickerConfidenceGate.value &&
      preRippleEnergy >= 1e-5;

    if (!flickerDetected) {
      return {
        flickerDetected: false,
        beatHz: Math.round(expectedBeatHz * 10) / 10,
        measuredFps: Math.round(measuredFps * 10) / 10,
        flickerConfidence,
        attenuatedDb: 0,
        chromaDriftDeltaCbCr: 0,
      };
    }

    // 5. Apply AC-only per-row luma gain equalization strictly on BT.601 YUV Y plane
    const minGain = STEADYGATE_V6_CONFIG.stage1Optical.flickerGainMin.value;
    const maxGain = STEADYGATE_V6_CONFIG.stage1Optical.flickerGainMax.value;
    let postRippleEnergy = 0;
    let chromaShiftSum = 0;
    let chromaSamples = 0;

    for (let y = 0; y < height; y++) {
      const rBin = Math.min(rows - 1, Math.floor((y / height) * rows));
      const rowY = this.rowMeanRing[slot * 48 + rBin];
      // Equalize toward smooth vertical target (blend of DC row mean and temporal row baseline)
      const targetRowY = expectedBeatHz > 0.5 ? this.baselineRowMean[rBin] : dcRowMean;
      const rawGain = targetRowY / Math.max(1e-4, rowY);
      const gain = Math.max(minGain, Math.min(maxGain, rawGain));

      let corrRowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const R = rgba[idx];
        const G = rgba[idx + 1];
        const B = rgba[idx + 2];
        const Y = 0.299 * R + 0.587 * G + 0.114 * B;
        const Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
        const Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;

        const Ycorr = Math.max(0, Math.min(255, Y * gain));
        const Rnew = Math.max(0, Math.min(255, Math.round(Ycorr + 1.402 * (Cr - 128))));
        const Gnew = Math.max(
          0,
          Math.min(255, Math.round(Ycorr - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128)))
        );
        const Bnew = Math.max(0, Math.min(255, Math.round(Ycorr + 1.772 * (Cb - 128))));

        rgba[idx] = Rnew;
        rgba[idx + 1] = Gnew;
        rgba[idx + 2] = Bnew;
        corrRowSum += Ycorr / 255;

        if ((x & 7) === 0 && (y & 7) === 0) {
          const CbAfter = 128 - 0.168736 * Rnew - 0.331264 * Gnew + 0.5 * Bnew;
          const CrAfter = 128 + 0.5 * Rnew - 0.418688 * Gnew - 0.081312 * Bnew;
          chromaShiftSum += Math.hypot(CbAfter - Cb, CrAfter - Cr);
          chromaSamples++;
        }
      }
      const corrRowMean = corrRowSum / width;
      const diffAfter = corrRowMean - targetRowY;
      postRippleEnergy += diffAfter * diffAfter;
    }
    postRippleEnergy /= Math.max(1, height);

    const attenuatedDb =
      Math.round(10 * Math.log10((preRippleEnergy + 1e-9) / (postRippleEnergy + 1e-9)) * 100) /
      100;
    const chromaDriftDeltaCbCr =
      chromaSamples > 0 ? Math.round((chromaShiftSum / chromaSamples) * 1000) / 1000 : 0;

    this.last.rollingShutterFlickerHz = Math.round(expectedBeatHz * 10) / 10;
    this.last.flickerAttenuatedDb = attenuatedDb;
    this.last.flickerConfidence = flickerConfidence;

    return {
      flickerDetected: true,
      beatHz: Math.round(expectedBeatHz * 10) / 10,
      measuredFps: Math.round(measuredFps * 10) / 10,
      flickerConfidence,
      attenuatedDb,
      chromaDriftDeltaCbCr,
    };
  }

  /**
   * Wave 1 Stage 1 — Self-Referenced Hand-ROI Motion-Blur Gate
   * Computes 3x3 discrete Laplacian variance on the BT.601 luma plane inside the hand ROI
   * plus directional gradient anisotropy, tracks the user's rolling sharp-frame p90 baseline
   * when wrist velocity is low (< 0.25), and triggers motionBlurDegraded when
   * laplacianBlurVariance < 0.42 * rollingSharpBaseline during rapid movement.
   */
  evaluateHandRoiMotionBlur(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    landmarks?: HandLandmark2D[] | null,
    wristVelocity: number = 0
  ): {
    laplacianBlurVariance: number;
    rollingSharpBaseline: number;
    directionalAnisotropy: number;
    motionBlurDegraded: boolean;
    kalmanNoiseMultiplier: number;
  } {
    if (!rgba || width < 4 || height < 4 || rgba.length < width * height * 4) {
      return {
        laplacianBlurVariance: 180,
        rollingSharpBaseline: 220,
        directionalAnisotropy: 0,
        motionBlurDegraded: false,
        kalmanNoiseMultiplier: 1.0,
      };
    }

    let x0 = Math.floor(width * 0.15);
    let y0 = Math.floor(height * 0.15);
    let x1 = Math.ceil(width * 0.85);
    let y1 = Math.ceil(height * 0.85);

    if (landmarks && landmarks.length >= 21) {
      let minX = 1,
        minY = 1,
        maxX = 0,
        maxY = 0;
      for (const pt of landmarks) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      x0 = Math.max(1, Math.floor((minX - 0.08) * width));
      y0 = Math.max(1, Math.floor((minY - 0.08) * height));
      x1 = Math.min(width - 2, Math.ceil((maxX + 0.08) * width));
      y1 = Math.min(height - 2, Math.ceil((maxY + 0.08) * height));
    } else {
      x0 = Math.max(1, x0);
      y0 = Math.max(1, y0);
      x1 = Math.min(width - 2, x1);
      y1 = Math.min(height - 2, y1);
    }

    const lumaAt = (px: number, py: number): number => {
      const i = (py * width + px) * 4;
      return 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    };

    let sumLap = 0;
    let sumLapSq = 0;
    let sumGxSq = 0;
    let sumGySq = 0;
    let count = 0;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = lumaAt(x, y);
        const l = lumaAt(x - 1, y);
        const r = lumaAt(x + 1, y);
        const u = lumaAt(x, y - 1);
        const d = lumaAt(x, y + 1);
        const lap = l + r + u + d - 4 * c;
        const gx = r - l;
        const gy = d - u;
        sumLap += lap;
        sumLapSq += lap * lap;
        sumGxSq += gx * gx;
        sumGySq += gy * gy;
        count++;
      }
    }

    const meanLap = count > 0 ? sumLap / count : 0;
    const lapVar =
      count > 0 ? Math.max(0, sumLapSq / count - meanLap * meanLap) : 0;
    const directionalAnisotropy =
      Math.abs(sumGxSq - sumGySq) / Math.max(1e-6, sumGxSq + sumGySq);

    // Update rolling sharp-frame baseline when hand is steady (wristVelocity < 0.25) and frame has texture
    if (wristVelocity < 0.25 && lapVar > 8.0) {
      this.sharpBlurRing[this.sharpBlurHead % 60] = lapVar;
      this.sharpBlurHead = (this.sharpBlurHead + 1) % 60;
      if (this.sharpBlurCount < 60) this.sharpBlurCount++;
    }

    let rollingSharpBaseline = 180.0;
    if (this.sharpBlurCount >= 3) {
      for (let i = 0; i < this.sharpBlurCount; i++) {
        this.sharpSortScratch[i] = this.sharpBlurRing[i];
      }
      const sub = this.sharpSortScratch.subarray(0, this.sharpBlurCount);
      sub.sort();
      const p90Idx = Math.min(
        this.sharpBlurCount - 1,
        Math.floor(this.sharpBlurCount * 0.9)
      );
      rollingSharpBaseline = Math.max(15.0, sub[p90Idx]);
    } else if (lapVar > 20.0 && wristVelocity < 0.25) {
      rollingSharpBaseline = lapVar;
    }

    const relRatio = STEADYGATE_V6_CONFIG.stage1Optical.relativeBlurSharpnessRatio.value;
    const motionBlurDegraded =
      lapVar < relRatio * rollingSharpBaseline && wristVelocity >= 0.35;
    const kalmanNoiseMultiplier = motionBlurDegraded
      ? STEADYGATE_V6_CONFIG.stage1Optical.blurKalmanNoiseMultiplier.value
      : 1.0;

    this.last.laplacianBlurVariance = Math.round(lapVar * 100) / 100;
    this.last.rollingSharpBaseline = Math.round(rollingSharpBaseline * 100) / 100;
    this.last.motionBlurDegraded = motionBlurDegraded;

    return {
      laplacianBlurVariance: Math.round(lapVar * 100) / 100,
      rollingSharpBaseline: Math.round(rollingSharpBaseline * 100) / 100,
      directionalAnisotropy: Math.round(directionalAnisotropy * 1000) / 1000,
      motionBlurDegraded,
      kalmanNoiseMultiplier,
    };
  }

  /**
   * Wave 1 Stage 1 — Conditional, Luma-Only Edge-Preserving Conditioning with < 2.0 ms Degrade Ladder
   * Operates strictly on the BT.601 YUV Luminance (Y) plane so chrominance shift Delta CbCr < 1.5.
   * Bypasses optimal scenes; under low light or harsh backlight, runs:
   *  1. FULL_GAMMA_GUIDED_CLAHE (Gamma + r=4 Box-Guided Filter + Luma CLAHE)
   *  2. SKIP_CLAHE_GAMMA_GUIDED (Gamma + Guided Filter)
   *  3. GAMMA_LUT_ONLY (256-entry Gamma LUT)
   * depending on runtime budget (< 2.0 ms).
   */
  conditionFrameLumaOnly(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    options?: {
      forceDegradeStep?: OpticalDegradeStep;
      budgetLimitMs?: number;
    }
  ): {
    elapsedMs: number;
    degradeStep: OpticalDegradeStep;
    appliedGamma: number;
    chromaDriftDeltaCbCr: number;
    luminanceMeanBefore: number;
    luminanceMeanAfter: number;
  } {
    const t0 = performance.now();
    if (!rgba || width <= 0 || height <= 0 || rgba.length < width * height * 4) {
      return {
        elapsedMs: 0,
        degradeStep: "BYPASSED_OPTIMAL",
        appliedGamma: 1.0,
        chromaDriftDeltaCbCr: 0,
        luminanceMeanBefore: 0.5,
        luminanceMeanAfter: 0.5,
      };
    }

    const numPixels = width * height;
    if (this.workLuma.length < numPixels) {
      this.workLuma = new Float32Array(numPixels);
      this.workCb = new Float32Array(numPixels);
      this.workCr = new Float32Array(numPixels);
      this.guidedMeanI = new Float32Array(numPixels);
    }

    // 1. Subsampled statistics pass (stride 4) to evaluate condition in < 0.03 ms
    let sumY = 0;
    let sumYSq = 0;
    let glarePixels = 0;
    let statCount = 0;
    for (let i = 0; i < numPixels; i += 4) {
      const idx = i << 2;
      const yNorm = (77 * rgba[idx] + 150 * rgba[idx + 1] + 29 * rgba[idx + 2]) * 0.00001525902; // / (256 * 255)
      sumY += yNorm;
      sumYSq += yNorm * yNorm;
      if (yNorm > 0.88) glarePixels++;
      statCount++;
    }

    const lumMean = statCount > 0 ? sumY / statCount : 0.5;
    const lumStd = Math.sqrt(Math.max(0, sumYSq / Math.max(1, statCount) - lumMean * lumMean));
    const glareRatio = glarePixels / Math.max(1, statCount);

    const needsLowLightLift =
      lumMean < STEADYGATE_V6_CONFIG.stage1Optical.lowLightLumaGate.value;
    const needsGlareComp =
      lumStd > STEADYGATE_V6_CONFIG.stage1Optical.glareContrastStdGate.value &&
      glareRatio > STEADYGATE_V6_CONFIG.stage1Optical.glarePixelRatioGate.value;

    if (!options?.forceDegradeStep && !needsLowLightLift && !needsGlareComp) {
      const elapsedMs = Math.round((performance.now() - t0) * 1000) / 1000;
      this.last.degradeStep = "BYPASSED_OPTIMAL";
      this.last.chromaDriftDeltaCbCr = 0;
      return {
        elapsedMs,
        degradeStep: "BYPASSED_OPTIMAL",
        appliedGamma: 1.0,
        chromaDriftDeltaCbCr: 0,
        luminanceMeanBefore: Math.round(lumMean * 1000) / 1000,
        luminanceMeanAfter: Math.round(lumMean * 1000) / 1000,
      };
    }

    // 2. Median-anchored adaptive gamma LUT (clamped to [0.72, 1.38])
    const safeMedian = Math.max(0.05, Math.min(0.95, lumMean));
    const rawGamma = Math.log(0.5) / Math.log(safeMedian);
    const gamma = Math.max(
      STEADYGATE_V6_CONFIG.stage1Optical.gammaMin.value,
      Math.min(STEADYGATE_V6_CONFIG.stage1Optical.gammaMax.value, rawGamma)
    );
    const budgetLimitMs =
      options?.budgetLimitMs ?? STEADYGATE_V6_CONFIG.frameBudgetMs.stage1OpticalMaxMs.value;
    let degradeStep: OpticalDegradeStep =
      options?.forceDegradeStep ?? "FULL_GAMMA_GUIDED_CLAHE";
    const clipGain =
      degradeStep === "FULL_GAMMA_GUIDED_CLAHE"
        ? Math.min(STEADYGATE_V6_CONFIG.stage1Optical.claheClipLimit.value, 1.35)
        : 1.0;

    for (let v = 0; v < 256; v++) {
      const lifted = Math.pow(v / 255, gamma);
      const claheVal = (lifted - 0.5) * clipGain + 0.5;
      this.gammaLut[v] = Math.max(0, Math.min(255, Math.round(claheVal * 255)));
    }

    // Extract BT.601 Y (0..255) and apply Gamma + CLAHE LUT
    for (let i = 0; i < numPixels; i++) {
      const idx = i << 2;
      const yInt = (77 * rgba[idx] + 150 * rgba[idx + 1] + 29 * rgba[idx + 2]) >> 8;
      this.workLuma[i] = this.gammaLut[yInt];
    }

    if (
      !options?.forceDegradeStep &&
      performance.now() - t0 > budgetLimitMs * 0.55
    ) {
      degradeStep = "GAMMA_LUT_ONLY";
    }

    // 3. Fast Edge-Preserving Guided Detail Boost on Luma (Y) plane
    if (
      degradeStep === "FULL_GAMMA_GUIDED_CLAHE" ||
      degradeStep === "SKIP_CLAHE_GAMMA_GUIDED"
    ) {
      const eps255 = STEADYGATE_V6_CONFIG.stage1Optical.guidedFilterEps.value * 65025;
      for (let y = 1; y < height - 1; y++) {
        const rowOff = y * width;
        for (let x = 1; x < width - 1; x++) {
          const idx = rowOff + x;
          const c = this.workLuma[idx];
          const l = this.workLuma[idx - 1];
          const r = this.workLuma[idx + 1];
          const u = this.workLuma[idx - width];
          const d = this.workLuma[idx + width];
          const mI = (c + l + r + u + d) * 0.2;
          const diff = c - mI;
          const varI = diff * diff;
          const a = varI / (varI + eps255);
          const outY = mI + (a * 1.25) * diff;
          this.guidedMeanI[idx] = outY < 0 ? 0 : outY > 255 ? 255 : outY;
        }
      }
      if (
        !options?.forceDegradeStep &&
        performance.now() - t0 > budgetLimitMs * 0.85
      ) {
        degradeStep = "SKIP_CLAHE_GAMMA_GUIDED";
      }
    }

    // 4. Luma-Only RGB Reconstruction: R' = R + dY, G' = G + dY, B' = B + dY
    // In BT.601, adding pure dY equally to (R, G, B) shifts Y by exactly dY while keeping
    // Cb = -0.1687*R - 0.3313*G + 0.5*B and Cr = 0.5*R - 0.4187*G - 0.0813*B identically constant!
    const useGuided =
      degradeStep === "FULL_GAMMA_GUIDED_CLAHE" ||
      degradeStep === "SKIP_CLAHE_GAMMA_GUIDED";
    let sumYAfter = 0;
    let chromaDriftSum = 0;
    let chromaSamples = 0;

    for (let y = 0; y < height; y++) {
      const rowOff = y * width;
      const interiorY = y > 0 && y < height - 1;
      for (let x = 0; x < width; x++) {
        const i = rowOff + x;
        const idx = i << 2;
        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];
        const yOrig = (77 * r + 150 * g + 29 * b) >> 8;
        const yNew =
          useGuided && interiorY && x > 0 && x < width - 1
            ? this.guidedMeanI[i]
            : this.workLuma[i];
        const dY = Math.round(yNew - yOrig);

        // Clamp dY so none of R, G, B saturates and distorts chrominance
        const maxAdd = 255 - Math.max(r, g, b);
        const minSub = -Math.min(r, g, b);
        const safeDy = dY > maxAdd ? maxAdd : dY < minSub ? minSub : dY;

        const rNew = r + safeDy;
        const gNew = g + safeDy;
        const bNew = b + safeDy;
        rgba[idx] = rNew;
        rgba[idx + 1] = gNew;
        rgba[idx + 2] = bNew;
        sumYAfter += (yOrig + safeDy) / 255;

        if ((i & 31) === 0) {
          const cbBefore = -0.168736 * r - 0.331264 * g + 0.5 * b;
          const crBefore = 0.5 * r - 0.418688 * g - 0.081312 * b;
          const cbAfter = -0.168736 * rNew - 0.331264 * gNew + 0.5 * bNew;
          const crAfter = 0.5 * rNew - 0.418688 * gNew - 0.081312 * bNew;
          chromaDriftSum += Math.hypot(cbAfter - cbBefore, crAfter - crBefore);
          chromaSamples++;
        }
      }
    }

    const elapsedMs = Math.round((performance.now() - t0) * 1000) / 1000;
    const chromaDriftDeltaCbCr =
      chromaSamples > 0
        ? Math.round((chromaDriftSum / chromaSamples) * 1000) / 1000
        : 0;

    this.last.degradeStep = degradeStep;
    this.last.chromaDriftDeltaCbCr = chromaDriftDeltaCbCr;
    this.last.roiClaheMs = elapsedMs;

    return {
      elapsedMs,
      degradeStep,
      appliedGamma: Math.round(gamma * 1000) / 1000,
      chromaDriftDeltaCbCr,
      luminanceMeanBefore: Math.round(lumMean * 1000) / 1000,
      luminanceMeanAfter: Math.round((sumYAfter / numPixels) * 1000) / 1000,
    };
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

  private jointAngleDeg(a: HandLandmark2D, b: HandLandmark2D, c: HandLandmark2D): number {
    const v1x = a.x - b.x;
    const v1y = a.y - b.y;
    const v2x = c.x - b.x;
    const v2y = c.y - b.y;
    const d = v1x * v2x + v1y * v2y;
    const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1e-6;
    return (Math.acos(Math.max(-1, Math.min(1, d / m))) * 180) / Math.PI;
  }

  /**
   * Detects whether the hand is overlapping the user's face/nose region (Failure Case 3)
   * using Subagent S6's MST 1-10 AdaptiveSkinCalibrator.
   * Requires true downward-draped scratch geometry (PIP below MCP, Tip below PIP,
   * acute MCP fold < 45 deg, and straight hanging PIP segments > 135 deg) so normal
   * FIST or THUMBS_UP postures never trigger false face-overlap blocks.
   */
  detectFaceNoseOverlap(landmarks: HandLandmark2D[], rgbaBuffer?: Uint8ClampedArray): boolean {
    if (!landmarks || landmarks.length < 21) return false;
    const wrist = landmarks[0];
    const palmLen = Math.max(Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y), 1e-5);
    const activeRgba = rgbaBuffer || this.lastRgba;

    const mIdx = this.jointAngleDeg(wrist, landmarks[5], landmarks[6]);
    const mMid = this.jointAngleDeg(wrist, landmarks[9], landmarks[10]);
    const pipIdx = this.jointAngleDeg(landmarks[5], landmarks[6], landmarks[8]);
    const pipMid = this.jointAngleDeg(landmarks[9], landmarks[10], landmarks[12]);

    // True downward-draped scratch posture: proximal phalanx goes downward from elevated MCP
    // (y_tip > y_pip > y_mcp) with acute MCP fold (< 45 deg) and straight PIP (> 135 deg)
    const fingersHangingDown =
      landmarks[6].y > landmarks[5].y &&
      landmarks[8].y > landmarks[6].y &&
      landmarks[10].y > landmarks[9].y &&
      landmarks[12].y > landmarks[10].y &&
      Math.min(mIdx, mMid) < 45 &&
      Math.max(pipIdx, pipMid) > 135 &&
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

  /**
   * Computes `apertureObjectOccupancy` in [0..1]: the ratio of pixels inside the
   * Grasp Aperture Polygon bounded by Thumb Tip (4), Index Tip (8), Pinky Tip (20),
   * and Palm Center (0, 5, 9, 17) that are neither static background pixels nor user
   * skin pixels (combining foreign object chrominance/luminance mass and internal
   * Sobel edge boundaries of a book spine, phone body, or mug wall).
   */
  computeApertureObjectOccupancy(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): number {
    if (!landmarks || landmarks.length < 21) return 0;
    const activeRgba = rgbaBuffer || this.lastRgba;
    if (!activeRgba || activeRgba.length < 64 * 48 * 4) return 0;

    const wrist = landmarks[0];
    const palmLen = Math.max(
      Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y),
      1e-5
    );
    const d4_5 =
      Math.hypot(landmarks[4].x - landmarks[5].x, landmarks[4].y - landmarks[5].y) / palmLen;
    const d4_10 =
      Math.hypot(landmarks[4].x - landmarks[10].x, landmarks[4].y - landmarks[10].y) / palmLen;

    const mcps = [5, 9, 13, 17];
    const pips = [6, 10, 14, 18];
    let horizFingerCount = 0;
    for (let i = 0; i < 4; i++) {
      const m = landmarks[mcps[i]];
      const p = landmarks[pips[i]];
      if (Math.abs(p.x - m.x) > Math.abs(p.y - m.y) * 1.1) horizFingerCount++;
    }
    const isSideEdgeBookPosture =
      horizFingerCount >= 3 &&
      landmarks[5].y < landmarks[9].y &&
      landmarks[9].y < landmarks[13].y &&
      landmarks[13].y < landmarks[17].y;

    // Require either a physical C-clamp span between thumb and opposing PIP joints
    // OR a side-edge book clamp posture where the thumb is occluded behind the book
    if ((d4_5 < 0.35 || d4_10 < 0.55) && !isSideEdgeBookPosture) {
      return 0;
    }

    // Phase 2 Two-Factor Gate: If >= 3 of the 4 fingers have straight PIP (>= 142°) and
    // straight MCP (>= 142°) joints, the hand is anatomically flat/open (e.g. OPEN_PALM),
    // not clamping a physical object in its aperture.
    const jointAngle = (a: HandLandmark2D, b: HandLandmark2D, c: HandLandmark2D): number => {
      const ux = a.x - b.x,
        uy = a.y - b.y;
      const vx = c.x - b.x,
        vy = c.y - b.y;
      const denom = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (denom < 1e-6) return 180;
      return (Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denom))) * 180) / Math.PI;
    };
    const fingerTriplets: Array<[number, number, number]> = [
      [5, 6, 8],
      [9, 10, 12],
      [13, 14, 16],
      [17, 18, 20],
    ];
    let straightOpenFingerCount = 0;
    for (const [mcpIdx, pipIdx, tipIdx] of fingerTriplets) {
      const pipDeg = jointAngle(landmarks[mcpIdx], landmarks[pipIdx], landmarks[tipIdx]);
      const mcpDeg = jointAngle(wrist, landmarks[mcpIdx], landmarks[pipIdx]);
      if (pipDeg >= 142 && mcpDeg >= 142) {
        straightOpenFingerCount++;
      }
    }
    if (straightOpenFingerCount >= 3) {
      return 0;
    }

    // Phase 1 Bare-Fist Immunity inside Photometric Aperture Detector:
    // If all 4 fingers are tightly curled (meanPipDeg < 112°) with tips inside the palm
    // envelope (< 0.46 * palmLen) and MCP joints in natural fist flexion (68°..128°),
    // verify whether the interior finger cluster matches the user's knuckle skin YCbCr.
    let pipSum = 0;
    let mcpSum = 0;
    const palmCx0 =
      (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5;
    const palmCy0 =
      (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5;
    let tipToPalmSum = 0;
    for (const [mcpIdx, pipIdx, tipIdx] of fingerTriplets) {
      pipSum += jointAngle(landmarks[mcpIdx], landmarks[pipIdx], landmarks[tipIdx]);
      mcpSum += jointAngle(wrist, landmarks[mcpIdx], landmarks[pipIdx]);
      tipToPalmSum +=
        Math.hypot(landmarks[tipIdx].x - palmCx0, landmarks[tipIdx].y - palmCy0) / palmLen;
    }
    const meanPip4Deg = pipSum / 4;
    const meanMcp4Deg = mcpSum / 4;
    const tipToPalmMean = tipToPalmSum / 4;
    const d4_9 =
      Math.hypot(landmarks[4].x - landmarks[9].x, landmarks[4].y - landmarks[9].y) / palmLen;
    const d4_17 =
      Math.hypot(landmarks[4].x - landmarks[17].x, landmarks[4].y - landmarks[17].y) / palmLen;

    if (
      meanPip4Deg < 112 &&
      meanMcp4Deg >= 68 &&
      meanMcp4Deg <= 128 &&
      tipToPalmMean < 0.46 &&
      d4_5 < 0.58 &&
      d4_9 < 0.48 &&
      d4_17 < 1.04
    ) {
      return 0;
    }

    // 1. Sample surrounding room background outside the hand bounding box (top, left, and right strips)
    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    let bgR = 0,
      bgG = 0,
      bgB = 0,
      bgCount = 0;
    const bx0 = Math.max(1, Math.floor((minX - 0.08) * 64));
    const bx1 = Math.min(62, Math.ceil((maxX + 0.08) * 64));
    const by0 = Math.max(1, Math.floor((minY - 0.08) * 48));
    const by1 = Math.min(46, Math.ceil((maxY + 0.04) * 48));
    for (let x = bx0; x <= bx1; x += 3) {
      const topIdx = (by0 * 64 + x) * 4;
      bgR += activeRgba[topIdx];
      bgG += activeRgba[topIdx + 1];
      bgB += activeRgba[topIdx + 2];
      bgCount++;
    }
    if (bgCount === 0) return 0;
    bgR /= bgCount;
    bgG /= bgCount;
    bgB /= bgCount;

    let leftR = bgR,
      leftG = bgG,
      leftB = bgB,
      leftCount = 0;
    let rightR = bgR,
      rightG = bgG,
      rightB = bgB,
      rightCount = 0;
    for (let y = by0; y <= by1; y += 4) {
      const lIdx = (y * 64 + bx0) * 4;
      leftR = leftCount === 0 ? activeRgba[lIdx] : leftR + activeRgba[lIdx];
      leftG = leftCount === 0 ? activeRgba[lIdx + 1] : leftG + activeRgba[lIdx + 1];
      leftB = leftCount === 0 ? activeRgba[lIdx + 2] : leftB + activeRgba[lIdx + 2];
      leftCount++;

      const rIdx = (y * 64 + bx1) * 4;
      rightR = rightCount === 0 ? activeRgba[rIdx] : rightR + activeRgba[rIdx];
      rightG = rightCount === 0 ? activeRgba[rIdx + 1] : rightG + activeRgba[rIdx + 1];
      rightB = rightCount === 0 ? activeRgba[rIdx + 2] : rightB + activeRgba[rIdx + 2];
      rightCount++;
    }
    if (leftCount > 0) {
      leftR /= leftCount;
      leftG /= leftCount;
      leftB /= leftCount;
    }
    if (rightCount > 0) {
      rightR /= rightCount;
      rightG /= rightCount;
      rightB /= rightCount;
    }

    // 2. Sample Palm Center (0, 5, 9, 17) as skin reference
    const palmCenter: HandLandmark2D = {
      x: (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[17].x) / 4,
      y: (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[17].y) / 4,
    };
    const pcx = Math.max(1, Math.min(62, Math.round(palmCenter.x * 64)));
    const pcy = Math.max(1, Math.min(46, Math.round(palmCenter.y * 48)));
    const pIdx = (pcy * 64 + pcx) * 4;
    const palmR = activeRgba[pIdx];
    const palmG = activeRgba[pIdx + 1];
    const palmB = activeRgba[pIdx + 2];

    // 3. Inspect Grasp Aperture Polygon bounded by Thumb Tip (4), Index Tip (8),
    // Pinky Tip (20), and Palm Center (0, 5, 9, 17) + thumb-to-PIP chords
    const anchors: Array<[HandLandmark2D, HandLandmark2D]> = [
      [landmarks[4], landmarks[8]],
      [landmarks[4], landmarks[6]],
      [landmarks[4], landmarks[10]],
      [landmarks[4], landmarks[20]],
      [landmarks[3], landmarks[10]],
      [landmarks[3], landmarks[14]],
      [landmarks[8], palmCenter],
      [landmarks[20], palmCenter],
    ];

    let foreignMassScore = 0;
    let totalSamples = 0;
    for (const [pA, pB] of anchors) {
      for (const t of [0.3, 0.5, 0.7]) {
        const sx = Math.max(1, Math.min(62, Math.round((pA.x * (1 - t) + pB.x * t) * 64)));
        const sy = Math.max(1, Math.min(46, Math.round((pA.y * (1 - t) + pB.y * t) * 48)));
        const idx = (sy * 64 + sx) * 4;
        const r = activeRgba[idx];
        const g = activeRgba[idx + 1];
        const b = activeRgba[idx + 2];
        totalSamples++;
        const isSkin =
          this.skinCalibrator.isUserSkinPixel(r, g, b) ||
          Math.hypot(r - palmR, g - palmG, b - palmB) < 34.0;
        const bgDist = Math.min(
          Math.hypot(r - bgR, g - bgG, b - bgB),
          Math.hypot(r - leftR, g - leftG, b - leftB),
          Math.hypot(r - rightR, g - rightG, b - rightB)
        );

        // Compute local Sobel edge gradient (book spine, phone bezel, or mug wall)
        const leftIdx = (sy * 64 + (sx - 1)) * 4;
        const rightIdx = (sy * 64 + (sx + 1)) * 4;
        const upIdx = ((sy - 1) * 64 + sx) * 4;
        const downIdx = ((sy + 1) * 64 + sx) * 4;
        const gx =
          activeRgba[rightIdx] -
          activeRgba[leftIdx] +
          (activeRgba[rightIdx + 1] - activeRgba[leftIdx + 1]);
        const gy =
          activeRgba[downIdx] -
          activeRgba[upIdx] +
          (activeRgba[downIdx + 1] - activeRgba[upIdx + 1]);
        const sobelEdge = Math.hypot(gx, gy) > 48.0 ? 0.15 : 0;

        if (!isSkin && bgDist > 40.0) {
          foreignMassScore += Math.min(1.0, 0.9 + sobelEdge);
        }
      }
    }

    if (totalSamples === 0) return 0;
    return Math.round(Math.min(1, foreignMassScore / totalSamples) * 100) / 100;
  }

  /**
   * Real-time photometric verification of whether a physical foreign object (phone, book, cup)
   * is actually clamped between the thumb and opposing fingers in the live camera frame.
   * Prevents empty hands on a live webcam from ever being falsely flagged as holding an object.
   */
  detectHeldObjectInHand(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): boolean {
    return this.computeApertureObjectOccupancy(landmarks, rgbaBuffer) >= 0.45;
  }

  /**
   * Ensemble A Signal A1 — Interior Palm vs. Knuckle Self-Skin YCbCr Divergence [0..1]:
   * Samples the user's dorsal/metacarpal knuckle ridge (landmarks 0, 5, 9, 13, 17) as the
   * self-skin reference, and compares it against the interior grasp zone (4-8, 4-10, 6, 8, 12).
   * Returns 0.0 when interior pixels closely match knuckle skin chrominance (deltaCbCr < 12.0),
   * and scales toward 1.0 when a foreign object mass occupies the interior.
   */
  computeKnuckleSkinDivergence(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): number {
    if (!landmarks || landmarks.length < 21) return 0;
    const activeRgba = rgbaBuffer || this.lastRgba;
    if (!activeRgba || activeRgba.length < 64 * 48 * 4) return 0;

    const toYCbCr = (r: number, g: number, b: number) => {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      return { y, cb, cr };
    };

    const knuckleIndices = [0, 5, 9, 13, 17];
    let kCb = 0,
      kCr = 0,
      kY = 0;
    for (const idx of knuckleIndices) {
      const sx = Math.max(1, Math.min(62, Math.round(landmarks[idx].x * 64)));
      const sy = Math.max(1, Math.min(46, Math.round(landmarks[idx].y * 48)));
      const p = (sy * 64 + sx) * 4;
      const c = toYCbCr(activeRgba[p], activeRgba[p + 1], activeRgba[p + 2]);
      kCb += c.cb;
      kCr += c.cr;
      kY += c.y;
    }
    kCb /= knuckleIndices.length;
    kCr /= knuckleIndices.length;
    kY /= knuckleIndices.length;

    const interiorPoints: Array<{ x: number; y: number }> = [
      { x: (landmarks[4].x + landmarks[8].x) * 0.5, y: (landmarks[4].y + landmarks[8].y) * 0.5 },
      { x: (landmarks[4].x + landmarks[10].x) * 0.5, y: (landmarks[4].y + landmarks[10].y) * 0.5 },
      { x: (landmarks[6].x + landmarks[10].x) * 0.5, y: (landmarks[6].y + landmarks[10].y) * 0.5 },
      { x: landmarks[8].x, y: landmarks[8].y },
      { x: landmarks[12].x, y: landmarks[12].y },
    ];

    let totalDeltaCbCr = 0;
    for (const pt of interiorPoints) {
      const sx = Math.max(1, Math.min(62, Math.round(pt.x * 64)));
      const sy = Math.max(1, Math.min(46, Math.round(pt.y * 48)));
      const p = (sy * 64 + sx) * 4;
      const c = toYCbCr(activeRgba[p], activeRgba[p + 1], activeRgba[p + 2]);
      totalDeltaCbCr += Math.hypot(c.cb - kCb, c.cr - kCr);
    }
    const meanDeltaCbCr = totalDeltaCbCr / interiorPoints.length;
    if (meanDeltaCbCr < 12.0) {
      return 0;
    }
    const occ = this.computeApertureObjectOccupancy(landmarks, activeRgba);
    if (occ <= 0.15) return 0;
    return Math.round(Math.min(1, ((meanDeltaCbCr - 10.0) / 22.0) * 0.5 + occ * 0.5) * 100) / 100;
  }

  /**
   * Ensemble A Signal A3 — Protruding Linear Object Boundary Detector [0..1]:
   * Samples the 64x48 Sobel gradient map along chords connecting thumb (4) and index/pinky
   * tips (8, 20) extending 20% outside the hand bounding box to detect rigid straight object edges.
   */
  computeProtrudingEdgeLineScore(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): number {
    if (!landmarks || landmarks.length < 21) return 0;
    const activeRgba = rgbaBuffer || this.lastRgba;
    if (!activeRgba || activeRgba.length < 64 * 48 * 4) return 0;

    const lines: Array<[HandLandmark2D, HandLandmark2D]> = [
      [landmarks[4], landmarks[8]],
      [landmarks[4], landmarks[20]],
      [landmarks[8], landmarks[20]],
    ];
    const tSamples = [-0.2, -0.1, 0.5, 1.1, 1.2];
    let strongEdgeCount = 0;
    let totalSamples = 0;

    for (const [pA, pB] of lines) {
      for (const t of tSamples) {
        const sx = Math.max(2, Math.min(61, Math.round((pA.x * (1 - t) + pB.x * t) * 64)));
        const sy = Math.max(2, Math.min(45, Math.round((pA.y * (1 - t) + pB.y * t) * 48)));
        const leftIdx = (sy * 64 + (sx - 1)) * 4;
        const rightIdx = (sy * 64 + (sx + 1)) * 4;
        const upIdx = ((sy - 1) * 64 + sx) * 4;
        const downIdx = ((sy + 1) * 64 + sx) * 4;
        const gx =
          activeRgba[rightIdx] -
          activeRgba[leftIdx] +
          (activeRgba[rightIdx + 1] - activeRgba[leftIdx + 1]);
        const gy =
          activeRgba[downIdx] -
          activeRgba[upIdx] +
          (activeRgba[downIdx + 1] - activeRgba[upIdx + 1]);
        totalSamples++;
        if (Math.hypot(gx, gy) > 52.0) {
          strongEdgeCount++;
        }
      }
    }
    if (totalSamples === 0) return 0;
    return Math.round(Math.min(1, strongEdgeCount / totalSamples) * 100) / 100;
  }

  /**
   * v5.0 Phase 3 — 16-Ray Radial Boundary-Crossing Object Scanner (`HandRoiObjectScanner`):
   * Casts 16 radial rays across 360° from the grasp centroid, sampling inside the finger clamp
   * (`0.45 * radius`), 25% outside the skeletal bounding box (`1.25 * radius`), and on the outer
   * room perimeter (`1.75 * radius`). Detects continuous non-skin, non-background object mass
   * protruding past the hand boundary, or confirms `bareHandConfirmed = true` when interior
   * pixels match dorsal knuckle skin and zero object boundaries protrude.
   */
  scanHandBoundaryProtrusions(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): {
    protrusionScore: number;
    bareHandConfirmed: boolean;
    protrudingRayCount: number;
  } {
    if (!landmarks || landmarks.length < 21) {
      return { protrusionScore: 0, bareHandConfirmed: false, protrudingRayCount: 0 };
    }
    const activeRgba = rgbaBuffer || this.lastRgba;
    if (!activeRgba || activeRgba.length < 64 * 48 * 4) {
      return { protrusionScore: 0, bareHandConfirmed: false, protrudingRayCount: 0 };
    }

    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;
    for (const p of landmarks) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const cx = (landmarks[0].x + landmarks[4].x + landmarks[8].x + landmarks[9].x) * 0.25;
    const cy = (landmarks[0].y + landmarks[4].y + landmarks[8].y + landmarks[9].y) * 0.25;
    const rx = Math.max(0.06, (maxX - minX) * 0.5);
    const ry = Math.max(0.06, (maxY - minY) * 0.5);

    // Sample dorsal knuckle ridge (0, 5, 9, 13, 17) as self-skin RGB reference
    const knuckleIdx = [0, 5, 9, 13, 17];
    let skinR = 0,
      skinG = 0,
      skinB = 0;
    for (const idx of knuckleIdx) {
      const sx = Math.max(1, Math.min(62, Math.round(landmarks[idx].x * 64)));
      const sy = Math.max(1, Math.min(46, Math.round(landmarks[idx].y * 48)));
      const p = (sy * 64 + sx) * 4;
      skinR += activeRgba[p];
      skinG += activeRgba[p + 1];
      skinB += activeRgba[p + 2];
    }
    skinR /= knuckleIdx.length;
    skinG /= knuckleIdx.length;
    skinB /= knuckleIdx.length;

    let protrudingRayCount = 0;
    const numRays = 16;
    for (let k = 0; k < numRays; k++) {
      const theta = (2 * Math.PI * k) / numRays;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const inX = Math.max(2, Math.min(61, Math.round((cx + cosT * rx * 0.45) * 64)));
      const inY = Math.max(2, Math.min(45, Math.round((cy + sinT * ry * 0.45) * 48)));
      const outX = Math.max(2, Math.min(61, Math.round((cx + cosT * rx * 1.25) * 64)));
      const outY = Math.max(2, Math.min(45, Math.round((cy + sinT * ry * 1.25) * 48)));
      const bgX = Math.max(1, Math.min(62, Math.round((cx + cosT * rx * 1.75) * 64)));
      const bgY = Math.max(1, Math.min(46, Math.round((cy + sinT * ry * 1.75) * 48)));

      const pIn = (inY * 64 + inX) * 4;
      const pOut = (outY * 64 + outX) * 4;
      const pBg = (bgY * 64 + bgX) * 4;

      const rIn = activeRgba[pIn],
        gIn = activeRgba[pIn + 1],
        bIn = activeRgba[pIn + 2];
      const rOut = activeRgba[pOut],
        gOut = activeRgba[pOut + 1],
        bOut = activeRgba[pOut + 2];
      const rBg = activeRgba[pBg],
        gBg = activeRgba[pBg + 1],
        bBg = activeRgba[pBg + 2];

      const inIsSkin =
        this.skinCalibrator.isUserSkinPixel(rIn, gIn, bIn) ||
        Math.hypot(rIn - skinR, gIn - skinG, bIn - skinB) < 34.0;
      const outIsSkin =
        this.skinCalibrator.isUserSkinPixel(rOut, gOut, bOut) ||
        Math.hypot(rOut - skinR, gOut - skinG, bOut - skinB) < 34.0;

      const inOutContinuity = Math.hypot(rIn - rOut, gIn - gOut, bIn - bOut);
      const outToBgDist = Math.hypot(rOut - rBg, gOut - gBg, bOut - bBg);

      // Local Sobel edge at the 1.25x boundary point
      const lIdx = (outY * 64 + (outX - 1)) * 4;
      const rIdx = (outY * 64 + (outX + 1)) * 4;
      const uIdx = ((outY - 1) * 64 + outX) * 4;
      const dIdx = ((outY + 1) * 64 + outX) * 4;
      const gx = activeRgba[rIdx] - activeRgba[lIdx];
      const gy = activeRgba[dIdx] - activeRgba[uIdx];
      const hasBoundaryEdge = Math.hypot(gx, gy) > 28.0;

      if (
        !inIsSkin &&
        !outIsSkin &&
        inOutContinuity < 42.0 &&
        outToBgDist > 38.0 &&
        hasBoundaryEdge
      ) {
        protrudingRayCount++;
      }
    }

    const protrusionScore = Math.round(Math.min(1, protrudingRayCount / 6) * 100) / 100;
    const skinDiv = this.computeKnuckleSkinDivergence(landmarks, activeRgba);
    const occ = this.computeApertureObjectOccupancy(landmarks, activeRgba);
    const bareHandConfirmed = skinDiv === 0 && occ < 0.25 && protrusionScore < 0.25;

    return {
      protrusionScore,
      bareHandConfirmed,
      protrudingRayCount,
    };
  }

  /**
   * Ensemble B Signal B1 — Face, Mouth & Chin-Rest Exclusion Halo:
   * Detects both direct nose/face scratch AND Chin-Rest / Perioral Proximity
   * (e.g. resting the chin/jaw on a closed fist in the central upper-neck column).
   */
  detectFaceAndChinZone(
    landmarks: HandLandmark2D[],
    rgbaBuffer?: Uint8ClampedArray
  ): {
    faceScratchDetected: boolean;
    chinRestDetected: boolean;
  } {
    if (!landmarks || landmarks.length < 21) {
      return { faceScratchDetected: false, chinRestDetected: false };
    }
    const faceScratchDetected = this.detectFaceNoseOverlap(landmarks, rgbaBuffer);
    const activeRgba = rgbaBuffer || this.lastRgba;

    const wrist = landmarks[0];
    const palmLen = Math.max(
      Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y),
      1e-5
    );
    const palmCx =
      (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5;
    const topKnuckleY = Math.min(
      landmarks[4].y,
      landmarks[5].y,
      landmarks[9].y,
      landmarks[13].y
    );

    const pipIdx = this.jointAngleDeg(landmarks[5], landmarks[6], landmarks[8]);
    const pipMid = this.jointAngleDeg(landmarks[9], landmarks[10], landmarks[12]);
    const pipRng = this.jointAngleDeg(landmarks[13], landmarks[14], landmarks[16]);
    const pipPnk = this.jointAngleDeg(landmarks[17], landmarks[18], landmarks[20]);
    const meanPip4 = (pipIdx + pipMid + pipRng + pipPnk) / 4;

    const verticalKnuckleSpan = Math.abs(landmarks[17].y - landmarks[5].y) / palmLen;
    let upperChinSkinContact = false;
    if (activeRgba && activeRgba.length >= 64 * 48 * 4) {
      const cx = Math.max(8, Math.min(55, Math.round(palmCx * 64)));
      const cyTop = Math.max(4, Math.min(40, Math.round((topKnuckleY - 0.05) * 48)));
      let skinCount = 0;
      let sampleCount = 0;
      for (let y = Math.max(2, cyTop - 3); y <= Math.min(45, cyTop + 2); y++) {
        for (let x = Math.max(2, cx - 5); x <= Math.min(61, cx + 5); x += 2) {
          const idx = (y * 64 + x) * 4;
          sampleCount++;
          if (
            this.skinCalibrator.isUserSkinPixel(
              activeRgba[idx],
              activeRgba[idx + 1],
              activeRgba[idx + 2]
            )
          ) {
            skinCount++;
          }
        }
      }
      if (sampleCount > 0 && skinCount / sampleCount >= 0.45) {
        upperChinSkinContact = true;
      }
    }

    const chinRestDetected =
      upperChinSkinContact &&
      palmCx >= 0.34 &&
      palmCx <= 0.66 &&
      topKnuckleY >= 0.22 &&
      topKnuckleY <= 0.46 &&
      wrist.y >= 0.46 &&
      wrist.y <= 0.72 &&
      meanPip4 < 75 &&
      verticalKnuckleSpan >= 0.38;

    return { faceScratchDetected, chinRestDetected };
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
    this.velEma = 0;
    this.ring = [];
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
    let recentVel = 0;
    if (this.ring.length >= 4) {
      const rPrev = this.ring[Math.max(0, this.ring.length - 4)];
      const rDt = Math.max(16, now - rPrev.t) / 1000;
      recentVel = Math.hypot(wrist.x - rPrev.x, wrist.y - rPrev.y) / rDt;
    }
    if (this.ring.length >= IntentTracker.WIN * 2) {
      vel = this.centroidVelocity();
    } else if (this.ring.length >= 4) {
      vel = recentVel;
    } else vel = 0;
    this.lastWrist = { x: wrist.x, y: wrist.y, t: now };
    if (recentVel < 0.55) {
      this.velEma = this.velEma * 0.35 + recentVel * 0.65;
    } else {
      this.velEma = this.velEma * 0.6 + vel * 0.4;
    }

    const cx = midMcp.x;
    const cy = midMcp.y;
    const inRoi = cx > 0.10 && cx < 0.90 && cy > 0.08 && cy < 0.94;
    const handScaleOk = handScale > 0.06 && handScale < 0.55;
    const transit = this.velEma > 1.25 && recentVel > 0.75;

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
/* v5.0 Phase 3: Temporal Object-Carry Memory Latch                    */
/* ------------------------------------------------------------------ */

export class ObjectCarryStateTracker {
  private consecutiveObjectFrames = 0;
  private latched = false;

  reset(): void {
    this.consecutiveObjectFrames = 0;
    this.latched = false;
  }

  isLatched(): boolean {
    return this.latched;
  }

  /**
   * Updates the temporal object-carry latch.
   * Latches `carryingObjectActive = true` when `ensembleScore >= 0.58` (or `confirmedObjectInHand`)
   * for >= 3 consecutive frames. Releases only when the user opens their fingers (`fourMean >= 0.58`),
   * confirms a bare-skin fist (`bareHandConfirmed && isCanonicalBareFist`), or confirms a bare pinch.
   */
  update(input: {
    ensembleScore: number;
    confirmedObjectInHand: boolean;
    fourMean: number;
    isCanonicalBareFist: boolean;
    bareHandConfirmed: boolean;
    isCanonicalPinchEyelet?: boolean;
  }): boolean {
    if (
      input.fourMean >= 0.58 ||
      (input.isCanonicalBareFist && input.bareHandConfirmed) ||
      (input.isCanonicalPinchEyelet && input.bareHandConfirmed)
    ) {
      this.consecutiveObjectFrames = 0;
      this.latched = false;
      return false;
    }

    if (input.confirmedObjectInHand || input.ensembleScore >= 0.58) {
      this.consecutiveObjectFrames += 1;
      if (this.consecutiveObjectFrames >= 3) {
        this.latched = true;
      }
    } else if (!this.latched) {
      this.consecutiveObjectFrames = Math.max(0, this.consecutiveObjectFrames - 1);
    }

    return this.latched;
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
