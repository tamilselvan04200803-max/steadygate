import { SpectrumDataPoint } from "./types";

export type TremorLockStage =
  | "INITIALIZED_60S_CALIB"
  | "OBSERVING_CONFIRMATION"
  | "FINALIZED_LOCKED";

export interface TremorLockStatus {
  stage: TremorLockStage;
  initializedF0Hz: number;
  activeF0Hz: number;
  confirmedF0Hz: number | null;
  activeAmpRms: number;
  confirmationProgress: number; // 0..100
  consistentWindows: number;
  requiredWindows: number;
  spectralConcentration: number; // 0..1 fraction of energy in f0 band
  irregularFreqRatio: number; // 0..1 fraction of energy in non-physiological (>12Hz or chaotic) band
  irregularFrequencyRejected: boolean;
  rejectedCount: number;
}

/**
 * Linear detrending of a 1D signal x[0..N-1].
 * Subtracts best-fit line y = a*t + b to eliminate DC bias and slow drift.
 */
export function linearDetrend(signal: number[]): number[] {
  const n = signal.length;
  if (n <= 1) return signal.slice();

  let sumT = 0;
  let sumX = 0;
  let sumTT = 0;
  let sumTX = 0;

  for (let i = 0; i < n; i++) {
    const t = i;
    const x = signal[i];
    sumT += t;
    sumX += x;
    sumTT += t * t;
    sumTX += t * x;
  }

  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-9) {
    const mean = sumX / n;
    return signal.map((x) => x - mean);
  }

  const slope = (n * sumTX - sumT * sumX) / denom;
  const intercept = (sumX - slope * sumT) / n;

  return signal.map((x, i) => x - (slope * i + intercept));
}

/**
 * Computes Discrete Fourier Transform (DFT) power spectrum for real-valued signal.
 * @param signal Detrended samples (e.g. 90 points = 3 seconds at 30 fps)
 * @param samplingRate Sampling frequency in Hz (typically 30 fps)
 */
export function computePowerSpectrum(
  signal: number[],
  samplingRate: number = 30
): { freqs: number[]; magnitudes: number[]; spectrumPoints: SpectrumDataPoint[] } {
  const n = signal.length;
  if (n === 0) {
    return { freqs: [], magnitudes: [], spectrumPoints: [] };
  }

  // Windowing: Apply Hann window to reduce spectral leakage
  const windowed: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
    windowed[i] = signal[i] * hann;
  }

  const numBins = Math.floor(n / 2) + 1;
  const freqs: number[] = new Array(numBins);
  const magnitudes: number[] = new Array(numBins);

  for (let k = 0; k < numBins; k++) {
    const freq = (k * samplingRate) / n;
    freqs[k] = Math.round(freq * 100) / 100;

    let real = 0;
    let imag = 0;
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * k * i) / n;
      real += windowed[i] * Math.cos(angle);
      imag -= windowed[i] * Math.sin(angle);
    }

    const mag = (2 * Math.sqrt(real * real + imag * imag)) / n;
    magnitudes[k] = mag;
  }

  const spectrumPoints: SpectrumDataPoint[] = freqs.map((f, idx) => ({
    freqHz: f,
    magnitude: magnitudes[idx],
    isPeak: false,
    inNotchBand: false,
  }));

  return { freqs, magnitudes, spectrumPoints };
}

/**
 * Extracts dominant tremor frequency f0, RMS amplitude in the 3-12 Hz physiological band,
 * Spectral Concentration Ratio (SCR), and irregular non-human frequency ratio (>12 Hz or broadband).
 */
export function extractMotionSignature(
  trajectoryY: number[],
  samplingRate: number = 30,
  minFreqHz: number = 2.5,
  maxFreqHz: number = 12.0
): {
  f0Hz: number;
  amplitudeRms: number;
  totalEnergy: number;
  spectralConcentration: number;
  irregularFreqRatio: number;
  irregularFrequencyDetected: boolean;
  spectrumPoints: SpectrumDataPoint[];
} {
  const detrended = linearDetrend(trajectoryY);
  const { freqs, magnitudes, spectrumPoints } = computePowerSpectrum(detrended, samplingRate);

  let peakIdx = -1;
  let maxMag = -1;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    if (f >= minFreqHz && f <= maxFreqHz) {
      if (magnitudes[i] > maxMag) {
        maxMag = magnitudes[i];
        peakIdx = i;
      }
    }
  }

  const f0Hz = peakIdx !== -1 && maxMag > 0.004 ? freqs[peakIdx] : 0.8;
  const notchBandHalf = 1.0;

  let bandEnergySum = 0;
  let totalEnergySum = 0;
  let irregularEnergySum = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const power = magnitudes[i] * magnitudes[i];
    if (f >= 0.5) {
      totalEnergySum += power;
    }

    const inBand = Math.abs(f - f0Hz) <= notchBandHalf;
    if (inBand && f >= minFreqHz && f <= maxFreqHz) {
      bandEnergySum += power;
    } else if (f > maxFreqHz || (f >= 1.2 && f < minFreqHz)) {
      irregularEnergySum += power;
    }

    spectrumPoints[i].isPeak = i === peakIdx && maxMag > 0.004;
    spectrumPoints[i].inNotchBand = inBand && f0Hz >= minFreqHz;
  }

  const amplitudeRms = Math.sqrt(bandEnergySum);
  const totalEnergy = Math.sqrt(totalEnergySum);
  const spectralConcentration =
    totalEnergySum > 1e-7 ? Math.min(1, bandEnergySum / totalEnergySum) : 1.0;
  const irregularFreqRatio =
    totalEnergySum > 1e-7 ? Math.min(1, irregularEnergySum / totalEnergySum) : 0.0;

  // Irregular non-human motion is flagged when total motion is significant (>0.012 RMS)
  // AND energy is dominated by frequencies outside the human 2.5-12Hz band (or broadband noise)
  const irregularFrequencyDetected =
    totalEnergy > 0.012 && (irregularFreqRatio > 0.52 || spectralConcentration < 0.25);

  return {
    f0Hz: Math.round(f0Hz * 10) / 10,
    amplitudeRms: Math.round(amplitudeRms * 1000) / 1000,
    totalEnergy: Math.round(totalEnergy * 1000) / 1000,
    spectralConcentration: Math.round(spectralConcentration * 100) / 100,
    irregularFreqRatio: Math.round(irregularFreqRatio * 100) / 100,
    irregularFrequencyDetected,
    spectrumPoints,
  };
}

export type TremorFrequencyLockStatus = TremorLockStatus;

/**
 * Progressive 3-Stage Human Tremor Frequency Personalizer:
 * 1. INITIALIZED_60S_CALIB: Starts from the user's 60-second calibration f0 and holds it fixed
 *    during the initial stabilization period (`fixedHoldWindows`).
 * 2. OBSERVING_CONFIRMATION: Continuously collects valid physiological tremor peaks (3-12 Hz),
 *    ignoring any irregular/non-human frequency bursts.
 * 3. FINALIZED_LOCKED: Once consistent observations confirm the user's natural tremor frequency
 *    (low std-dev <= 0.45 Hz across `requiredConfirmWindows`), locks and finalizes f0.
 */
export class AdaptiveTremorFrequencyTracker {
  private initializedF0Hz: number;
  private activeF0Hz: number;
  private confirmedF0Hz: number | null = null;
  private activeAmpRms: number;
  private windowCount = 0;
  private validF0History: number[] = [];
  private validAmpHistory: number[] = [];
  private rejectedIrregularCount = 0;
  private stage: TremorLockStage = "INITIALIZED_60S_CALIB";

  constructor(
    initialF0Hz: number = 5.2,
    initialAmpRms: number = 0.045,
    private fixedHoldWindows: number = 4,
    private requiredConfirmWindows: number = 8
  ) {
    this.initializedF0Hz = initialF0Hz;
    this.activeF0Hz = initialF0Hz;
    this.activeAmpRms = initialAmpRms;
  }

  reset(initialF0Hz: number = 5.2, initialAmpRms: number = 0.045): void {
    this.initializedF0Hz = initialF0Hz;
    this.activeF0Hz = initialF0Hz;
    this.confirmedF0Hz = null;
    this.activeAmpRms = initialAmpRms;
    this.windowCount = 0;
    this.validF0History = [];
    this.validAmpHistory = [];
    this.rejectedIrregularCount = 0;
    this.stage = "INITIALIZED_60S_CALIB";
  }

  resetToCalibration(initialF0Hz: number = 5.2, initialAmpRms: number = 0.045): void {
    this.reset(initialF0Hz, initialAmpRms);
  }

  observeSignature(signature: {
    f0Hz: number;
    amplitudeRms: number;
    totalEnergy: number;
    spectralConcentration?: number;
    irregularFreqRatio?: number;
    irregularFrequencyDetected?: boolean;
  }): TremorLockStatus {
    return this.observe(signature);
  }

  getStatus(): TremorLockStatus {
    return this.status();
  }

  syncUserBaseline(userF0Hz: number, userAmpRms: number): void {
    if (Math.abs(userF0Hz - this.initializedF0Hz) > 0.25 && this.stage === "INITIALIZED_60S_CALIB") {
      this.initializedF0Hz = userF0Hz;
      this.activeF0Hz = userF0Hz;
      this.activeAmpRms = userAmpRms;
    }
  }

  observe(signature: {
    f0Hz: number;
    amplitudeRms: number;
    totalEnergy: number;
    spectralConcentration?: number;
    irregularFreqRatio?: number;
    irregularFrequencyDetected?: boolean;
  }): TremorLockStatus {
    const scr = signature.spectralConcentration ?? 0.75;
    const irrRatio = signature.irregularFreqRatio ?? 0.05;
    const isIrregular =
      signature.irregularFrequencyDetected ||
      (signature.totalEnergy > 0.012 && (irrRatio > 0.52 || scr < 0.25));

    if (isIrregular) {
      this.rejectedIrregularCount += 1;
      return this.status(scr, irrRatio, true);
    }

    this.windowCount += 1;

    // Only learn from physiological tremor peaks in [3.0, 12.0] Hz with meaningful amplitude
    const isPhysiologicalTremor =
      signature.f0Hz >= 3.0 &&
      signature.f0Hz <= 12.0 &&
      signature.amplitudeRms >= 0.005 &&
      scr >= 0.35;

    if (isPhysiologicalTremor) {
      this.validF0History.push(signature.f0Hz);
      this.validAmpHistory.push(signature.amplitudeRms);
      if (this.validF0History.length > 20) {
        this.validF0History.shift();
        this.validAmpHistory.shift();
      }
    }

    // Stage 1: Hold initialized 60s calibration f0 fixed during stabilization window
    if (this.windowCount <= this.fixedHoldWindows) {
      this.stage = "INITIALIZED_60S_CALIB";
      this.activeF0Hz = this.initializedF0Hz;
      return this.status(scr, irrRatio, false);
    }

    // Stage 2 & 3: Confirm dominant tremor frequency and finalize once converged
    if (this.stage !== "FINALIZED_LOCKED") {
      this.stage = "OBSERVING_CONFIRMATION";
      if (this.validF0History.length >= 3) {
        const sorted = [...this.validF0History].sort((a, b) => a - b);
        const medianF0 = sorted[Math.floor(sorted.length / 2)];
        const meanF0 =
          this.validF0History.reduce((acc, v) => acc + v, 0) / this.validF0History.length;
        const stdF0 = Math.sqrt(
          this.validF0History.reduce((acc, v) => acc + (v - meanF0) * (v - meanF0), 0) /
            this.validF0History.length
        );

        // Smoothly blend initialized f0 with observed median during confirmation
        this.activeF0Hz = Math.round((0.4 * this.initializedF0Hz + 0.6 * medianF0) * 10) / 10;

        const sortedAmp = [...this.validAmpHistory].sort((a, b) => a - b);
        const medianAmp = sortedAmp[Math.floor(sortedAmp.length / 2)];
        this.activeAmpRms =
          Math.round((0.4 * this.activeAmpRms + 0.6 * medianAmp) * 1000) / 1000;

        if (
          this.validF0History.length >= this.requiredConfirmWindows &&
          stdF0 <= 0.48
        ) {
          // If observed natural frequency is close to initialized 60s f0 or consistently converged, finalize!
          this.confirmedF0Hz =
            Math.abs(medianF0 - this.initializedF0Hz) <= 0.35
              ? this.initializedF0Hz
              : Math.round((0.25 * this.initializedF0Hz + 0.75 * medianF0) * 10) / 10;
          this.activeF0Hz = this.confirmedF0Hz;
          this.stage = "FINALIZED_LOCKED";
        }
      }
    }

    return this.status(scr, irrRatio, false);
  }

  status(
    scr: number = 0.8,
    irrRatio: number = 0.05,
    irregularRejected: boolean = false
  ): TremorLockStatus {
    const progress =
      this.stage === "FINALIZED_LOCKED"
        ? 100
        : Math.min(
            95,
            Math.round(
              (Math.min(this.validF0History.length, this.requiredConfirmWindows) /
                this.requiredConfirmWindows) *
                100
            )
          );

    return {
      stage: this.stage,
      initializedF0Hz: this.initializedF0Hz,
      activeF0Hz: this.activeF0Hz,
      confirmedF0Hz: this.confirmedF0Hz,
      activeAmpRms: this.activeAmpRms,
      confirmationProgress: progress,
      consistentWindows: this.validF0History.length,
      requiredWindows: this.requiredConfirmWindows,
      spectralConcentration: scr,
      irregularFreqRatio: irrRatio,
      irregularFrequencyRejected: irregularRejected,
      rejectedCount: this.rejectedIrregularCount,
    };
  }
}

/**
 * Subagent S4 — Intrinsic vs. Extrinsic Dyskinesia Decoupling
 * Measures how steady the 5-finger flexion posture is held relative to the palm
 * across a sliding window of frames. High intrinsic stability (>= 0.82, rmsIntrinsicJitter < 0.04)
 * during 1-3 Hz extrinsic wrist sway indicates intentional posture under Levodopa ON-state dyskinesia.
 */
export function computeIntrinsicPostureStability(
  flexionHistory: Array<[number, number, number, number, number]>
): {
  intrinsicStability: number;
  rmsIntrinsicJitter: number;
} {
  if (!flexionHistory || flexionHistory.length < 2) {
    return { intrinsicStability: 1.0, rmsIntrinsicJitter: 0.0 };
  }

  const n = flexionHistory.length;
  const means = [0, 0, 0, 0, 0];
  for (const frame of flexionHistory) {
    for (let i = 0; i < 5; i++) {
      means[i] += frame[i] ?? 0;
    }
  }
  for (let i = 0; i < 5; i++) {
    means[i] /= n;
  }

  let varSum = 0;
  for (const frame of flexionHistory) {
    for (let i = 0; i < 5; i++) {
      const diff = (frame[i] ?? 0) - means[i];
      varSum += diff * diff;
    }
  }

  const rmsIntrinsicJitter = Math.sqrt(varSum / (n * 5));
  const intrinsicStability = Math.max(0, Math.min(1, 1.0 - rmsIntrinsicJitter / 0.12));

  return {
    intrinsicStability: Math.round(intrinsicStability * 100) / 100,
    rmsIntrinsicJitter: Math.round(rmsIntrinsicJitter * 1000) / 1000,
  };
}

/**
 * Calculates raw vs signature-normalized stability (F2).
 * Signature-normalized stability attenuates tremor motion in the f0 band,
 * compensates 1-3 Hz Levodopa ON-state dyskinesia when intrinsic finger posture is stable (>= 0.82),
 * and penalizes irregular non-human frequencies outside the user's tremor profile.
 */
export function calculateNormalizedStability(
  currentMagnitudes: number[],
  freqs: number[],
  userF0Hz: number,
  userBaselineRms: number,
  notchWidthHz: number = 2.0,
  intrinsicStability?: number
): {
  stabilityRaw: number;
  stabilityNorm: number;
  residualRms: number;
  tremorRatio: number;
  dyskinesiaCompensated?: boolean;
} {
  const halfWidth = notchWidthHz / 2;
  let rawEnergy = 0;
  let residualEnergy = 0;
  let tremorEnergy = 0;
  let dyskinesiaEnergy = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const mag = currentMagnitudes[i] || 0;
    const power = mag * mag;
    rawEnergy += power;

    const isTremorBand = Math.abs(f - userF0Hz) <= halfWidth;
    if (isTremorBand) {
      tremorEnergy += power;
      // Digital notch filter attenuates 92% of the user's personalized tremor frequency
      residualEnergy += power * 0.08;
    } else if (f > 12.0) {
      // Penalize non-human / erratic high-frequency vibrations (>12 Hz) by 1.6x
      residualEnergy += power * 1.6;
    } else if (intrinsicStability !== undefined && f >= 0.8 && f <= 3.2) {
      dyskinesiaEnergy += power;
      if (intrinsicStability >= 0.82) {
        // ON-state Levodopa dyskinesia (1-3 Hz chorea) with steady intrinsic finger posture
        residualEnergy += power * 0.12;
      } else {
        // Erratic low-frequency bump with unstable fingers is penalized by 3.5x
        residualEnergy += power * 3.5;
      }
    } else {
      residualEnergy += power;
    }
  }

  const rawRms = Math.sqrt(rawEnergy);
  const residualRms = Math.sqrt(residualEnergy);

  const fixedThreshold = 0.022;
  const stabilityRaw = Math.max(0, Math.min(1, 1.0 - rawRms / fixedThreshold));

  const effectiveBaseline = Math.max(userBaselineRms * 1.5, 0.015);
  const stabilityNorm = Math.max(0, Math.min(1, 1.0 - residualRms / effectiveBaseline));

  const tremorRatio = userBaselineRms > 0 ? rawRms / userBaselineRms : 1.0;
  const dyskinesiaCompensated =
    intrinsicStability !== undefined && intrinsicStability >= 0.82 && dyskinesiaEnergy > 1e-5;

  return {
    stabilityRaw: Math.round(stabilityRaw * 100) / 100,
    stabilityNorm: Math.round(stabilityNorm * 100) / 100,
    residualRms: Math.round(residualRms * 1000) / 1000,
    tremorRatio: Math.round(tremorRatio * 100) / 100,
    dyskinesiaCompensated,
  };
}
