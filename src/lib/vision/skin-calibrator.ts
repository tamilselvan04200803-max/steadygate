/**
 * Subagent S6 — Adaptive MST 1–10 Skin Calibrator & Background Chrominance Mask
 * Self-calibrates YCbCr skin chrominance distribution (mean & variance) from the user's
 * live palm centroid across Monk Skin Tones (MST 1 to MST 10) and 2700K-6500K lighting,
 * while subtracting static background chrominance (e.g., wooden doors / warm beige walls).
 */

export const MONK_SKIN_TONE_RGB_REFERENCE: Array<{
  mst: number;
  hex: string;
  rgb: [number, number, number];
}> = [
  { mst: 1, hex: "#f6ede4", rgb: [246, 237, 228] },
  { mst: 2, hex: "#f3e7db", rgb: [243, 231, 219] },
  { mst: 3, hex: "#f7ead0", rgb: [247, 234, 208] },
  { mst: 4, hex: "#eadaba", rgb: [234, 218, 186] },
  { mst: 5, hex: "#d7bd96", rgb: [215, 189, 150] },
  { mst: 6, hex: "#a07e56", rgb: [160, 126, 86] },
  { mst: 7, hex: "#825c43", rgb: [130, 92, 67] },
  { mst: 8, hex: "#604134", rgb: [96, 65, 52] },
  { mst: 9, hex: "#3a312a", rgb: [58, 49, 42] },
  { mst: 10, hex: "#292420", rgb: [41, 36, 32] },
];

export function rgbToYCbCr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return { y, cb, cr };
}

export class AdaptiveSkinCalibrator {
  private meanCb = 108.0;
  private meanCr = 148.0;
  private varCb = 144.0; // sigma = 12
  private varCr = 144.0; // sigma = 12
  private sampleCount = 0;

  private bgMeanCb: number | null = null;
  private bgMeanCr: number | null = null;
  private bgSamples = 0;

  reset(): void {
    this.meanCb = 108.0;
    this.meanCr = 148.0;
    this.varCb = 144.0;
    this.varCr = 144.0;
    this.sampleCount = 0;
    this.bgMeanCb = null;
    this.bgMeanCr = null;
    this.bgSamples = 0;
  }

  /**
   * Samples a 3x3 patch around the palm centroid (mean of landmarks 0, 5, 9, 17)
   * when the hand is in a confirmed non-overlapping free-hand posture.
   */
  samplePalmPatch(
    rgba: Uint8ClampedArray,
    width: number,
    height: number,
    palmCentroidX: number,
    palmCentroidY: number,
    alpha = 0.08
  ): void {
    if (!rgba || rgba.length < width * height * 4) return;
    const cx = Math.max(1, Math.min(width - 2, Math.round(palmCentroidX * width)));
    const cy = Math.max(1, Math.min(height - 2, Math.round(palmCentroidY * height)));

    let sumCb = 0;
    let sumCr = 0;
    let count = 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = ((cy + dy) * width + (cx + dx)) * 4;
        const r = rgba[idx];
        const g = rgba[idx + 1];
        const b = rgba[idx + 2];
        const { y, cb, cr } = rgbToYCbCr(r, g, b);
        if (y >= 16 && y <= 248) {
          sumCb += cb;
          sumCr += cr;
          count++;
        }
      }
    }

    if (count === 0) return;
    const patchCb = sumCb / count;
    const patchCr = sumCr / count;

    if (this.sampleCount === 0) {
      this.meanCb = patchCb;
      this.meanCr = patchCr;
      this.varCb = 36.0;
      this.varCr = 36.0;
    } else {
      const dCb = patchCb - this.meanCb;
      const dCr = patchCr - this.meanCr;
      this.meanCb = (1 - alpha) * this.meanCb + alpha * patchCb;
      this.meanCr = (1 - alpha) * this.meanCr + alpha * patchCr;
      this.varCb = Math.max(16.0, Math.min(225.0, (1 - alpha) * this.varCb + alpha * dCb * dCb));
      this.varCr = Math.max(16.0, Math.min(225.0, (1 - alpha) * this.varCr + alpha * dCr * dCr));
    }
    this.sampleCount++;
  }

  /**
   * Samples static background chrominance in the upper-central ROI when no hand is present
   * so wooden doors or warm walls can be subtracted from face/nose overlap checks.
   */
  sampleBackgroundRoi(rgba: Uint8ClampedArray, width: number, height: number): void {
    if (!rgba || rgba.length < width * height * 4) return;
    const x0 = Math.floor(width * 0.35);
    const x1 = Math.floor(width * 0.65);
    const y0 = Math.floor(height * 0.15);
    const y1 = Math.floor(height * 0.45);

    let sumCb = 0;
    let sumCr = 0;
    let count = 0;
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        const idx = (y * width + x) * 4;
        const { cb, cr } = rgbToYCbCr(rgba[idx], rgba[idx + 1], rgba[idx + 2]);
        sumCb += cb;
        sumCr += cr;
        count++;
      }
    }
    if (count === 0) return;
    const mCb = sumCb / count;
    const mCr = sumCr / count;
    if (this.bgMeanCb === null || this.bgMeanCr === null) {
      this.bgMeanCb = mCb;
      this.bgMeanCr = mCr;
    } else {
      this.bgMeanCb = 0.9 * this.bgMeanCb + 0.1 * mCb;
      this.bgMeanCr = 0.9 * this.bgMeanCr + 0.1 * mCr;
    }
    this.bgSamples++;
  }

  /**
   * Evaluates whether an RGB pixel matches the user's calibrated skin chrominance
   * via Mahalanobis distance (distSq <= 4.5), or wide inclusive MST 1-10 prior before lock.
   */
  isUserSkinPixel(r: number, g: number, b: number): boolean {
    const { y, cb, cr } = rgbToYCbCr(r, g, b);
    if (y < 14 || y > 250) return false;

    // Subtract stationary background wall/wood tone if background is distinct from user's locked palm skin
    if (
      this.bgSamples >= 3 &&
      this.bgMeanCb !== null &&
      this.bgMeanCr !== null &&
      this.sampleCount >= 3
    ) {
      const palmToBgDist = Math.hypot(this.meanCb - this.bgMeanCb, this.meanCr - this.bgMeanCr);
      const pixToBgDist = Math.hypot(cb - this.bgMeanCb, cr - this.bgMeanCr);
      if (palmToBgDist > 8.0 && pixToBgDist < 3.5) {
        return false;
      }
    }

    if (this.sampleCount > 0) {
      const dCb = cb - this.meanCb;
      const dCr = cr - this.meanCr;
      const distSq = (dCb * dCb) / Math.max(16.0, this.varCb) + (dCr * dCr) / Math.max(16.0, this.varCr);
      return distSq <= 4.5;
    }

    // Wide inclusive MST 1-10 prior before first palm sample is captured
    return r >= 24 && cb >= 72 && cb <= 136 && cr >= 126 && cr <= 180;
  }

  getState() {
    return {
      meanCb: Math.round(this.meanCb * 100) / 100,
      meanCr: Math.round(this.meanCr * 100) / 100,
      varCb: Math.round(this.varCb * 100) / 100,
      varCr: Math.round(this.varCr * 100) / 100,
      sampleCount: this.sampleCount,
      bgSamples: this.bgSamples,
    };
  }
}
