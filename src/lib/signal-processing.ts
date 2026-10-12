import { SpectrumDataPoint } from "./types";

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
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
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

    // Normalized magnitude
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
 * Extracts dominant tremor frequency f0 and RMS amplitude in the 3-12 Hz band.
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

  // Fallback to physiological default if no distinct peak
  const f0Hz = peakIdx !== -1 && maxMag > 0.005 ? freqs[peakIdx] : 0.8;
  const notchBandHalf = 1.0;

  // Compute RMS amplitude in the f0 ± 1.0 Hz band
  let bandEnergySum = 0;
  let totalEnergySum = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const power = magnitudes[i] * magnitudes[i];
    totalEnergySum += power;

    const inBand = Math.abs(f - f0Hz) <= notchBandHalf;
    if (inBand) {
      bandEnergySum += power;
    }

    spectrumPoints[i].isPeak = i === peakIdx && maxMag > 0.005;
    spectrumPoints[i].inNotchBand = inBand && f0Hz >= minFreqHz;
  }

  const amplitudeRms = Math.sqrt(bandEnergySum);
  const totalEnergy = Math.sqrt(totalEnergySum);

  return {
    f0Hz: Math.round(f0Hz * 10) / 10,
    amplitudeRms: Math.round(amplitudeRms * 1000) / 1000,
    totalEnergy: Math.round(totalEnergy * 1000) / 1000,
    spectrumPoints,
  };
}

/**
 * Calculates raw vs signature-normalized stability (F2).
 * Signature-normalized stability attenuates tremor motion in the f0 band
 * and evaluates whether non-tremor residual motion is quiet.
 */
export function calculateNormalizedStability(
  currentMagnitudes: number[],
  freqs: number[],
  userF0Hz: number,
  userBaselineRms: number,
  notchWidthHz: number = 2.0
): {
  stabilityRaw: number;
  stabilityNorm: number;
  residualRms: number;
  tremorRatio: number;
} {
  const halfWidth = notchWidthHz / 2;
  let rawEnergy = 0;
  let residualEnergy = 0;
  let tremorEnergy = 0;

  for (let i = 0; i < freqs.length; i++) {
    const f = freqs[i];
    const mag = currentMagnitudes[i] || 0;
    const power = mag * mag;
    rawEnergy += power;

    const isTremorBand = Math.abs(f - userF0Hz) <= halfWidth;
    if (isTremorBand) {
      tremorEnergy += power;
      // Digital notch filter attenuates 92% of the user's tremor frequency
      residualEnergy += power * 0.08;
    } else {
      residualEnergy += power;
    }
  }

  const rawRms = Math.sqrt(rawEnergy);
  const residualRms = Math.sqrt(residualEnergy);

  // Raw stability assumes a global fixed threshold of 0.02
  const fixedThreshold = 0.022;
  const stabilityRaw = Math.max(0, Math.min(1, 1.0 - rawRms / fixedThreshold));

  // Signature-normalized stability divides residual non-tremor motion by user's baseline
  const effectiveBaseline = Math.max(userBaselineRms * 1.5, 0.015);
  const stabilityNorm = Math.max(0, Math.min(1, 1.0 - residualRms / effectiveBaseline));

  const tremorRatio = userBaselineRms > 0 ? rawRms / userBaselineRms : 1.0;

  return {
    stabilityRaw: Math.round(stabilityRaw * 100) / 100,
    stabilityNorm: Math.round(stabilityNorm * 100) / 100,
    residualRms: Math.round(residualRms * 1000) / 1000,
    tremorRatio: Math.round(tremorRatio * 100) / 100,
  };
}
