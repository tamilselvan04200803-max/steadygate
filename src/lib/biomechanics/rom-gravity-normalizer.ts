import type { UserAnatomicalCalibration } from "../../../.swarm/contracts/types";

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Subagent S3 — Per-Finger ROM & Bed-Incline Gravity Normalizer
 * Normalizes raw 5-finger extension values against a user's personal active Range of Motion (ROM)
 * so users with osteoarthritic contractures, post-stroke spasticity, or Parkinsonian rigidity
 * (e.g., maxExtension = 0.52) achieve full [0..1] dynamic range without division-by-zero risks.
 */
export function normalizeFingerROM(
  rawExt: [number, number, number, number, number],
  userCalib?: Partial<UserAnatomicalCalibration> | null
): [number, number, number, number, number] {
  if (!userCalib || (!userCalib.minFlexion && !userCalib.maxExtension)) {
    return rawExt;
  }

  const minFlex = userCalib.minFlexion ?? [0.02, 0.02, 0.02, 0.02, 0.02];
  const maxExt = userCalib.maxExtension ?? [0.95, 0.95, 0.95, 0.95, 0.95];

  return rawExt.map((val, idx) => {
    const minV = clamp01(minFlex[idx] ?? 0.02);
    const maxV = Math.max(minV + 0.25, clamp01(maxExt[idx] ?? 0.95));
    const denom = Math.max(0.25, maxV - minV);
    return Math.round(clamp01((val - minV) / denom) * 1000) / 1000;
  }) as [number, number, number, number, number];
}

/**
 * Rotates a 2D camera-space vector (dx, dy) into the user's torso-aligned gravity frame
 * to compensate for bed-incline or wheelchair head-tilt angles (-60 deg to +60 deg).
 */
export function projectOntoTorsoGravity(
  vecX: number,
  vecY: number,
  bedTiltDeg: number = 0
): { x: number; y: number } {
  const clampedDeg = Math.max(-60, Math.min(60, bedTiltDeg || 0));
  if (Math.abs(clampedDeg) < 0.5) {
    return { x: vecX, y: vecY };
  }
  const rad = (-clampedDeg * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  return {
    x: vecX * cosA - vecY * sinA,
    y: vecX * sinA + vecY * cosA,
  };
}

/**
 * Passively tracks per-finger 5th and 95th extension percentiles over valid free-hand frames
 * to build an individualized ROM calibration profile for users with contractures.
 */
export class AdaptiveRomCalibrator {
  private history: [number[], number[], number[], number[], number[]] = [[], [], [], [], []];
  private maxWindow = 120;

  observe(rawExt: [number, number, number, number, number]): void {
    for (let i = 0; i < 5; i++) {
      const arr = this.history[i];
      arr.push(clamp01(rawExt[i]));
      if (arr.length > this.maxWindow) {
        arr.shift();
      }
    }
  }

  getCalibration(bedTiltDeg: number = 0): UserAnatomicalCalibration {
    const minFlexion: [number, number, number, number, number] = [0.02, 0.02, 0.02, 0.02, 0.02];
    const maxExtension: [number, number, number, number, number] = [0.95, 0.95, 0.95, 0.95, 0.95];

    for (let i = 0; i < 5; i++) {
      const sorted = [...this.history[i]].sort((a, b) => a - b);
      if (sorted.length >= 10) {
        const p05 = sorted[Math.floor(sorted.length * 0.05)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        minFlexion[i] = Math.round(p05 * 1000) / 1000;
        maxExtension[i] = Math.round(Math.max(minFlexion[i] + 0.25, p95) * 1000) / 1000;
      }
    }

    return {
      minFlexion,
      maxExtension,
      bedTiltDeg: Math.max(-60, Math.min(60, bedTiltDeg)),
    };
  }
}
