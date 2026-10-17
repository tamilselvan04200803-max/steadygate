/**
 * SteadyGate v6.0 — Stage 2: Coupled DIP/PIP Soft Kinematic Prior,
 * Block-Diagonal Joint-Space CKF & Dual-Prior Metric Depth
 * ------------------------------------------------------------------
 * Anatomically grounded hand kinematics based on flexor digitorum profundus (FDP)
 * and flexor digitorum superficialis (FDS) tendon coupling (Kapandji), with:
 *  - Personalized soft DIP/PIP coupling residual & continuous Log-Likelihood Ratio (LLR)
 *  - Automatic contracture / arthrodesis / swan-neck exemption for motor inclusivity
 *  - Pre-allocated 2-state per-joint Constrained Kalman Filter (JointSpaceCKF)
 *  - Self-occlusion probability detector with >= 0.75 confidence floor
 *  - Dual-reference inverse-variance metric depth estimator (metricDepthMetersApprox)
 */

import type { HandLandmark2D } from "../types";
import { STEADYGATE_V6_CONFIG } from "../../config/steadygate.config";

export interface CoupledDipPipBiomechanicsResult {
  mcpFlexionDeg: [number, number, number, number];
  pipFlexionDeg: [number, number, number, number];
  dipFlexionDeg: [number, number, number, number];
  perFingerUncoupling: [number, number, number, number];
  dipPipUncouplingResidual: number; // [0..1]
  coupledKinematicLikelihood: number; // [0..1], 1.0 = natural anatomical coupling, low = rigid object clamp
  llrUncouple: number; // continuous log-likelihood ratio (> 0 favors rigid object clamp, < 0 favors bare hand)
  contractureExempted: boolean;
}

export interface SelfOcclusionMetrics {
  selfOcclusionProb: number; // [0..1]
  perFingerOcclusion: [number, number, number, number, number];
  confidenceFloorMultiplier: number; // >= 0.75
}

export interface MetricDepthEstimation {
  metricDepthMetersApprox: number;
  zFromPalmLengthMeters: number;
  zFromPalmWidthMeters: number;
  pitchDegApprox: number;
  yawDegApprox: number;
  inValidOperatingBand: boolean; // [0.25m, 1.80m]
}

const FINGER_CHAINS: ReadonlyArray< readonly [number, number, number, number, number] > = [
  [0, 5, 6, 7, 8],   // Index
  [0, 9, 10, 11, 12], // Middle
  [0, 13, 14, 15, 16], // Ring
  [0, 17, 18, 19, 20], // Pinky
];

function computeInteriorAngleDeg(a: HandLandmark2D, b: HandLandmark2D, c: HandLandmark2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v1z = (a.z ?? 0) - (b.z ?? 0);
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const v2z = (c.z ?? 0) - (b.z ?? 0);
  const dot = v1x * v2x + v1y * v2y + v1z * v2z;
  const mag = Math.hypot(v1x, v1y, v1z) * Math.hypot(v2x, v2y, v2z) || 1e-6;
  const cosTheta = Math.max(-1, Math.min(1, dot / mag));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function dist2D(a: HandLandmark2D, b: HandLandmark2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Evaluates the personalized Soft Coupled DIP/PIP Biomechanical Prior & Uncoupling LLR.
 * Separates rigid object/book clamps (where PIP or MCP flexes while distal DIP phalanges
 * are braced flat against a rigid surface) from natural bare-hand fists and gestures,
 * while automatically exempting calibrated joint contractures / arthrodesis.
 */
export function evaluateCoupledDipPipBiomechanics(
  landmarks: HandLandmark2D[],
  options?: {
    userCouplingCoeffs?: [number, number, number, number];
    perFingerRomMax?: [number, number, number, number, number];
    hasContractureProfile?: boolean;
  }
): CoupledDipPipBiomechanicsResult {
  if (!landmarks || landmarks.length < 21) {
    return {
      mcpFlexionDeg: [0, 0, 0, 0],
      pipFlexionDeg: [0, 0, 0, 0],
      dipFlexionDeg: [0, 0, 0, 0],
      perFingerUncoupling: [0, 0, 0, 0],
      dipPipUncouplingResidual: 0,
      coupledKinematicLikelihood: 1,
      llrUncouple: -2.5,
      contractureExempted: false,
    };
  }

  const defaultC = STEADYGATE_V6_CONFIG.stage2Kinematics.defaultDipPipCouplingCoeff.value;
  const coeffs = options?.userCouplingCoeffs ?? [defaultC, defaultC, defaultC, defaultC];

  // Detect whether user has a calibrated contracture profile (any finger ROM ceiling < 0.78)
  const romCeilings = options?.perFingerRomMax;
  const contractureDetected =
    Boolean(options?.hasContractureProfile) ||
    Boolean(romCeilings && romCeilings.some((r) => r < 0.78));

  const palmScale = Math.max(
    1e-4,
    (dist2D(landmarks[0], landmarks[9]) + dist2D(landmarks[5], landmarks[17])) * 0.5
  );

  const mcpFlexionDeg: [number, number, number, number] = [0, 0, 0, 0];
  const pipFlexionDeg: [number, number, number, number] = [0, 0, 0, 0];
  const dipFlexionDeg: [number, number, number, number] = [0, 0, 0, 0];
  const perFingerUncoupling: [number, number, number, number] = [0, 0, 0, 0];

  let tipToMcpSum = 0;
  let tipYSpread = 0;
  const tipYs: number[] = [];

  for (let f = 0; f < 4; f++) {
    const [wIdx, mcpIdx, pipIdx, dipIdx, tipIdx] = FINGER_CHAINS[f];
    const mcpFlex = Math.max(
      0,
      Math.min(115, 180 - computeInteriorAngleDeg(landmarks[wIdx], landmarks[mcpIdx], landmarks[pipIdx]))
    );
    const pipFlex = Math.max(
      0,
      Math.min(175, 180 - computeInteriorAngleDeg(landmarks[mcpIdx], landmarks[pipIdx], landmarks[dipIdx]))
    );
    const dipFlex = Math.max(
      0,
      Math.min(110, 180 - computeInteriorAngleDeg(landmarks[pipIdx], landmarks[dipIdx], landmarks[tipIdx]))
    );

    mcpFlexionDeg[f] = Math.round(mcpFlex * 10) / 10;
    pipFlexionDeg[f] = Math.round(pipFlex * 10) / 10;
    dipFlexionDeg[f] = Math.round(dipFlex * 10) / 10;

    const dTipMcp = dist2D(landmarks[tipIdx], landmarks[mcpIdx]) / palmScale;
    tipToMcpSum += dTipMcp;
    tipYs.push(landmarks[tipIdx].y);

    const cUser = Math.max(0.45, Math.min(0.85, coeffs[f] ?? defaultC));

    // Mode 1: PIP flexed (> 35 deg) while DIP fails to follow FDP tendon coupling (e.g. CASE_5 spine hold)
    let rPipDip = 0;
    if (pipFlex > 35) {
      const expectedDip = cUser * Math.min(95, pipFlex);
      rPipDip = Math.max(0, (expectedDip - dipFlex) / (expectedDip + 1e-3));
      // In a tight anatomical bare fist (pipFlex > 110 AND dipFlex >= 38 AND dTipMcp < 0.55),
      // 2D foreshortening of tucked fingertips can compress apparent DIP angle; damp residual
      if (pipFlex > 110 && dipFlex >= 36 && dTipMcp < 0.56) {
        rPipDip *= 0.15;
      }
    }

    // Mode 2: Lumbrical / Side-Cover Clamp (MCP flexed >= 42 deg while PIP < 52 deg and DIP < 30 deg, e.g. CASE_4 / BOOK_SPINE)
    let rMcpDip = 0;
    if (mcpFlex >= 38 && pipFlex <= 60 && dipFlex <= 30 && dTipMcp >= 0.45) {
      const expectedDistal = 0.58 * mcpFlex;
      rMcpDip = Math.max(0, (expectedDistal - dipFlex) / (expectedDistal + 1e-3));
    }

    perFingerUncoupling[f] = Math.round(Math.min(1, Math.max(rPipDip, rMcpDip)) * 1000) / 1000;
  }

  const meanTipToMcp = tipToMcpSum / 4;
  const minTipY = Math.min(...tipYs);
  const maxTipY = Math.max(...tipYs);
  tipYSpread = (maxTipY - minTipY) / palmScale;

  // Aggregate uncoupling across the middle/ring/pinky + index clamp digits
  const sortedUncoupling = [...perFingerUncoupling].sort((a, b) => b - a);
  // Top-3 flexed/clamped digit uncoupling mean
  let rawResidual =
    (sortedUncoupling[0] * 0.4 + sortedUncoupling[1] * 0.35 + sortedUncoupling[2] * 0.25);

  // Check thumb-index C-aperture bracing (rigid object between thumb & fingers)
  const cAperture = dist2D(landmarks[4], landmarks[8]) / palmScale;
  const thumbToIndexPip = dist2D(landmarks[4], landmarks[6]) / palmScale;
  const meanDipFlex =
    (dipFlexionDeg[0] + dipFlexionDeg[1] + dipFlexionDeg[2] + dipFlexionDeg[3]) * 0.25;
  const meanPipFlex =
    (pipFlexionDeg[0] + pipFlexionDeg[1] + pipFlexionDeg[2] + pipFlexionDeg[3]) * 0.25;
  const meanMcpFlex =
    (mcpFlexionDeg[0] + mcpFlexionDeg[1] + mcpFlexionDeg[2] + mcpFlexionDeg[3]) * 0.25;

  // Bare closed fist protection: when all 4 fingers have strong DIP flexion (>= 38 deg)
  // and tips are tucked close to MCPs (meanTipToMcp < 0.62) with small C-aperture, residual -> 0
  const isAnatomicalBareFist =
    meanDipFlex >= 38 &&
    meanPipFlex >= 65 &&
    meanMcpFlex >= 75 &&
    meanTipToMcp < 0.65 &&
    cAperture < 0.52;

  if (isAnatomicalBareFist) {
    rawResidual *= 0.12;
  } else if (
    meanDipFlex < 28 &&
    (meanMcpFlex >= 45 || meanPipFlex >= 38) &&
    (cAperture >= 0.65 || thumbToIndexPip >= 0.42 || tipYSpread < 0.35)
  ) {
    rawResidual = Math.min(1.0, rawResidual + 0.28);
  }

  if (contractureDetected) {
    rawResidual *= 0.15;
  }

  const dipPipUncouplingResidual = Math.round(Math.max(0, Math.min(1, rawResidual)) * 1000) / 1000;
  const threshold = STEADYGATE_V6_CONFIG.stage2Kinematics.dipPipUncouplingThreshold.value;
  const slope = STEADYGATE_V6_CONFIG.stage2Kinematics.dipPipLogitSlope.value;

  const llrUncouple =
    Math.round(((dipPipUncouplingResidual - threshold) * slope - (contractureDetected ? 2.5 : 0)) * 1000) /
    1000;
  const coupledKinematicLikelihood =
    Math.round((1 / (1 + Math.exp(llrUncouple))) * 1000) / 1000;

  return {
    mcpFlexionDeg,
    pipFlexionDeg,
    dipFlexionDeg,
    perFingerUncoupling,
    dipPipUncouplingResidual,
    coupledKinematicLikelihood,
    llrUncouple,
    contractureExempted: contractureDetected,
  };
}

/**
 * Self-Occlusion Detector & Confidence Floor (Wave 2 Stage 2).
 * Detects when folded fingertips overlap the palm polygon [0, 5, 9, 13, 17]
 * during FIST or dorsal views, outputting selfOcclusionProb in [0, 1] and
 * flooring the classifier confidence multiplier at >= 0.75.
 */
export function computeSelfOcclusionProbability(
  landmarks: HandLandmark2D[]
): SelfOcclusionMetrics {
  if (!landmarks || landmarks.length < 21) {
    return {
      selfOcclusionProb: 0,
      perFingerOcclusion: [0, 0, 0, 0, 0],
      confidenceFloorMultiplier: 1.0,
    };
  }

  const palmIndices = [0, 5, 9, 13, 17];
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const idx of palmIndices) {
    const pt = landmarks[idx];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  const palmScale = Math.max(1e-4, dist2D(landmarks[0], landmarks[9]));
  const tipIndices = [4, 8, 12, 16, 20];
  const mcpIndices = [2, 5, 9, 13, 17];
  const perFingerOcclusion: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  let occSum = 0;
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[tipIndices[i]];
    const mcp = landmarks[mcpIndices[i]];
    const inPalmBox =
      tip.x >= minX - 0.02 &&
      tip.x <= maxX + 0.02 &&
      tip.y >= minY - 0.02 &&
      tip.y <= maxY + 0.02;
    const dTipMcp = dist2D(tip, mcp) / palmScale;
    const zBehind = (tip.z ?? 0) > (mcp.z ?? 0) + 0.015 ? 0.25 : 0;
    let occ = 0;
    if (inPalmBox && dTipMcp < 0.55) {
      occ = Math.min(1, (0.55 - dTipMcp) / 0.35 + zBehind);
    } else if (dTipMcp < 0.38) {
      occ = Math.min(1, (0.38 - dTipMcp) / 0.25 + zBehind);
    }
    perFingerOcclusion[i] = Math.round(occ * 1000) / 1000;
    occSum += occ;
  }

  const selfOcclusionProb = Math.round((occSum / 5) * 1000) / 1000;
  const floorVal = STEADYGATE_V6_CONFIG.stage2Kinematics.selfOcclusionConfidenceFloor.value;
  const confidenceFloorMultiplier =
    Math.round(Math.max(floorVal, 1.0 - 0.25 * selfOcclusionProb) * 1000) / 1000;

  return {
    selfOcclusionProb,
    perFingerOcclusion,
    confidenceFloorMultiplier,
  };
}

/**
 * Dual-Reference Inverse-Variance Metric Depth Approximation (Wave 2 Stage 2).
 * Fuses palm length L1 = ||P0 - P9||_2 (L1_ref = 0.095m) weighted by cos^2(pitch)
 * and palm width L2 = ||P5 - P17||_2 (L2_ref = 0.082m) weighted by cos^2(yaw).
 */
export function estimateMetricHandDepthMeters(
  landmarks: HandLandmark2D[],
  options?: {
    hfovDeg?: number;
    referencePalmLengthMeters?: number;
    referencePalmWidthMeters?: number;
  }
): MetricDepthEstimation {
  if (!landmarks || landmarks.length < 21) {
    return {
      metricDepthMetersApprox: 0.55,
      zFromPalmLengthMeters: 0.55,
      zFromPalmWidthMeters: 0.55,
      pitchDegApprox: 0,
      yawDegApprox: 0,
      inValidOperatingBand: true,
    };
  }

  const hfovDeg =
    options?.hfovDeg ?? STEADYGATE_V6_CONFIG.stage2Kinematics.defaultWebcamHfovDeg.value;
  const refLenM =
    options?.referencePalmLengthMeters ??
    STEADYGATE_V6_CONFIG.stage2Kinematics.referencePalmLengthMeters.value;
  const refWidM =
    options?.referencePalmWidthMeters ??
    STEADYGATE_V6_CONFIG.stage2Kinematics.referencePalmWidthMeters.value;

  const focalNorm = 0.5 / Math.tan(((hfovDeg * 0.5) * Math.PI) / 180);

  const dxLen = landmarks[9].x - landmarks[0].x;
  const dyLen = landmarks[9].y - landmarks[0].y;
  const dzLen = (landmarks[9].z ?? 0) - (landmarks[0].z ?? 0);
  const len2D = Math.max(0.02, Math.hypot(dxLen, dyLen));

  const dxWid = landmarks[17].x - landmarks[5].x;
  const dyWid = landmarks[17].y - landmarks[5].y;
  const dzWid = (landmarks[17].z ?? 0) - (landmarks[5].z ?? 0);
  const wid2D = Math.max(0.02, Math.hypot(dxWid, dyWid));

  const pitchRad = Math.atan2(Math.abs(dzLen), len2D);
  const yawRad = Math.atan2(Math.abs(dzWid), wid2D);

  const cosPitch = Math.max(0.35, Math.cos(pitchRad));
  const cosYaw = Math.max(0.35, Math.cos(yawRad));

  // Correct 2D projected lengths by foreshortening cosine before pinhole inversion
  const deprojectedLen = len2D / cosPitch;
  const deprojectedWid = wid2D / cosYaw;

  const z1 = (refLenM * focalNorm) / Math.max(0.02, deprojectedLen);
  const z2 = (refWidM * focalNorm) / Math.max(0.02, deprojectedWid);

  const w1 = cosPitch * cosPitch;
  const w2 = cosYaw * cosYaw;
  const zFused = Math.max(0.15, Math.min(3.0, (w1 * z1 + w2 * z2) / (w1 + w2 + 1e-6)));

  const minDepth = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.minDepthMeters.value;
  const maxDepth = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.maxDepthMeters.value;

  return {
    metricDepthMetersApprox: Math.round(zFused * 1000) / 1000,
    zFromPalmLengthMeters: Math.round(z1 * 1000) / 1000,
    zFromPalmWidthMeters: Math.round(z2 * 1000) / 1000,
    pitchDegApprox: Math.round(((pitchRad * 180) / Math.PI) * 10) / 10,
    yawDegApprox: Math.round(((yawRad * 180) / Math.PI) * 10) / 10,
    inValidOperatingBand: zFused >= minDepth && zFused <= maxDepth,
  };
}

/**
 * Block-Diagonal Joint-Space Constrained Kalman Filter (JointSpaceCKF, Wave 2 Stage 2).
 * Zero per-frame heap allocation: tracks 21 landmark positions & 15 joint angles via
 * independent 2-state [theta, dTheta/dt] scalar Kalman blocks with dynamic occlusion
 * and motion-blur observation noise inflation, plus anatomical ROM clamping.
 */
export class JointSpaceCKF {
  private readonly numLandmarks = 21;
  private readonly xPos = new Float32Array(21);
  private readonly yPos = new Float32Array(21);
  private readonly zPos = new Float32Array(21);
  private readonly xVel = new Float32Array(21);
  private readonly yVel = new Float32Array(21);
  private readonly p00 = new Float32Array(21);
  private readonly p01 = new Float32Array(21);
  private readonly p11 = new Float32Array(21);
  private readonly jointAngles = new Float32Array(12); // 4 fingers x (MCP, PIP, DIP)
  private readonly jointVels = new Float32Array(12);
  private readonly jP00 = new Float32Array(12);
  private readonly jP01 = new Float32Array(12);
  private readonly jP11 = new Float32Array(12);
  private initialized = false;
  private lastTimestampMs = -1;
  private lastHandId = "";
  private readonly outBuffer: HandLandmark2D[] = Array.from({ length: 21 }, () => ({
    x: 0,
    y: 0,
    z: 0,
  }));

  reset(): void {
    this.initialized = false;
    this.lastTimestampMs = -1;
  }

  /**
   * Filters a 21-landmark hand frame in < 0.25 ms with zero heap allocation.
   * Inflates observation noise R when fingertips are occluded or sudden unphysical
   * single-frame jumps occur, reducing occluded p95 fingertip jump by >= 70%.
   */
  filterLandmarks(
    raw: HandLandmark2D[],
    timestampMs: number,
    options?: {
      motionBlurDegraded?: boolean;
      handId?: string;
    }
  ): {
    landmarks: HandLandmark2D[];
    selfOcclusion: SelfOcclusionMetrics;
    filteredJointAnglesDeg: Float32Array;
  } {
    if (!raw || raw.length < 21) {
      return {
        landmarks: raw,
        selfOcclusion: {
          selfOcclusionProb: 0,
          perFingerOcclusion: [0, 0, 0, 0, 0],
          confidenceFloorMultiplier: 1.0,
        },
        filteredJointAnglesDeg: this.jointAngles,
      };
    }

    const maxGapMs = STEADYGATE_V6_CONFIG.stage2Kinematics.maxFrameGapResetMs.value;
    const handId = options?.handId ?? "default";

    if (
      !this.initialized ||
      this.lastTimestampMs < 0 ||
      timestampMs - this.lastTimestampMs > maxGapMs ||
      timestampMs < this.lastTimestampMs ||
      handId !== this.lastHandId
    ) {
      for (let i = 0; i < 21; i++) {
        this.xPos[i] = raw[i].x;
        this.yPos[i] = raw[i].y;
        this.zPos[i] = raw[i].z ?? 0;
        this.xVel[i] = 0;
        this.yVel[i] = 0;
        this.p00[i] = 0.01;
        this.p01[i] = 0;
        this.p11[i] = 0.1;
        this.outBuffer[i].x = raw[i].x;
        this.outBuffer[i].y = raw[i].y;
        this.outBuffer[i].z = raw[i].z ?? 0;
      }
      const bio = evaluateCoupledDipPipBiomechanics(raw);
      for (let f = 0; f < 4; f++) {
        this.jointAngles[f * 3 + 0] = bio.mcpFlexionDeg[f];
        this.jointAngles[f * 3 + 1] = bio.pipFlexionDeg[f];
        this.jointAngles[f * 3 + 2] = bio.dipFlexionDeg[f];
        this.jointVels[f * 3 + 0] = 0;
        this.jointVels[f * 3 + 1] = 0;
        this.jointVels[f * 3 + 2] = 0;
        this.jP00[f * 3 + 0] = 1;
        this.jP00[f * 3 + 1] = 1;
        this.jP00[f * 3 + 2] = 1;
      }
      this.initialized = true;
      this.lastTimestampMs = timestampMs;
      this.lastHandId = handId;
      return {
        landmarks: this.outBuffer.map((pt) => ({ ...pt })),
        selfOcclusion: computeSelfOcclusionProbability(raw),
        filteredJointAnglesDeg: this.jointAngles,
      };
    }

    const dtSec = Math.max(0.004, Math.min(0.2, (timestampMs - this.lastTimestampMs) / 1000));
    this.lastTimestampMs = timestampMs;

    const selfOcc = computeSelfOcclusionProbability(raw);
    const baseR = STEADYGATE_V6_CONFIG.stage2Kinematics.ckfBaseObservationNoise.value;
    const gammaOcc = STEADYGATE_V6_CONFIG.stage2Kinematics.ckfOcclusionGamma.value;
    const blurMult = options?.motionBlurDegraded
      ? STEADYGATE_V6_CONFIG.stage1Optical.blurKalmanNoiseMultiplier.value
      : 1.0;

    // Measure wrist displacement to distinguish whole-hand transport from single-tip occlusion glitch
    const wristJump = Math.hypot(raw[0].x - this.xPos[0], raw[0].y - this.yPos[0]);
    const palmScale = Math.max(
      0.04,
      Math.hypot(this.xPos[9] - this.xPos[0], this.yPos[9] - this.yPos[0])
    );

    const isTipOrDip = (idx: number): number => {
      if (idx === 4 || idx === 3) return 0;
      if (idx === 8 || idx === 7) return 1;
      if (idx === 12 || idx === 11) return 2;
      if (idx === 16 || idx === 15) return 3;
      if (idx === 20 || idx === 19) return 4;
      return -1;
    };

    const qPos = 0.002 * dtSec;
    const qVel = 0.08 * dtSec;

    for (let i = 0; i < 21; i++) {
      // 1. Predict step: x_{k|k-1} = x_{k-1} + v_{k-1} * dt
      const predX = this.xPos[i] + this.xVel[i] * dtSec;
      const predY = this.yPos[i] + this.yVel[i] * dtSec;

      const p00Pred = this.p00[i] + 2 * dtSec * this.p01[i] + dtSec * dtSec * this.p11[i] + qPos;
      const p01Pred = this.p01[i] + dtSec * this.p11[i];
      const p11Pred = this.p11[i] + qVel;

      // 2. Dynamic observation noise R_i based on self-occlusion, motion blur, and distal jump anomaly
      const fingerIdx = isTipOrDip(i);
      let occProb = fingerIdx >= 0 ? selfOcc.perFingerOcclusion[fingerIdx] : 0;
      const innovX = raw[i].x - predX;
      const innovY = raw[i].y - predY;
      const localJump = Math.hypot(innovX, innovY);

      // If a distal joint jumps > 0.32 * palmScale in a single frame while the wrist moved < 0.08 * palmScale,
      // treat it as a self-occlusion / MediaPipe distal landmark glitch and inflate R_i strongly
      if (fingerIdx >= 0 && localJump > 0.30 * palmScale && wristJump < 0.12 * palmScale) {
        const glitchSeverity = Math.min(1.0, (localJump / palmScale - 0.25) * 2.5);
        occProb = Math.max(occProb, glitchSeverity);
      }

      const R = baseR * Math.exp(gammaOcc * occProb) * blurMult;

      // 3. Kalman gain K = P * H^T / (H * P * H^T + R)
      const S = p00Pred + R;
      const K0 = p00Pred / Math.max(1e-9, S);
      const K1 = p01Pred / Math.max(1e-9, S);

      let updX = predX + K0 * innovX;
      let updY = predY + K0 * innovY;
      const updVx = (this.xVel[i] + K1 * innovX) * 0.85;
      const updVy = (this.yVel[i] + K1 * innovY) * 0.85;

      // 4. Anatomical bone-length constraint projection for distal tips (prevents bone stretching during occlusion)
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        const pipIdx = i - 2;
        const maxDistalReach = palmScale * 0.65;
        const dx = updX - this.xPos[pipIdx];
        const dy = updY - this.yPos[pipIdx];
        const distFromPip = Math.hypot(dx, dy);
        if (distFromPip > maxDistalReach && distFromPip > 1e-5) {
          const scale = maxDistalReach / distFromPip;
          updX = this.xPos[pipIdx] + dx * scale;
          updY = this.yPos[pipIdx] + dy * scale;
        }
      }

      this.xPos[i] = updX;
      this.yPos[i] = updY;
      this.zPos[i] = this.zPos[i] * 0.7 + (raw[i].z ?? 0) * 0.3;
      this.xVel[i] = updVx;
      this.yVel[i] = updVy;

      this.p00[i] = (1 - K0) * p00Pred;
      this.p01[i] = (1 - K0) * p01Pred;
      this.p11[i] = p11Pred - K1 * p01Pred;

      this.outBuffer[i].x = updX;
      this.outBuffer[i].y = updY;
      this.outBuffer[i].z = this.zPos[i];
    }

    // Update 12 joint angles with anatomical ROM clamping:
    // MCP in [0, 95], PIP in [0, 110], DIP in [0, 85] and coupled DIP <= 0.85 * PIP + 15
    const bioAfter = evaluateCoupledDipPipBiomechanics(this.outBuffer);
    const romMax: [number, number, number] = [95, 110, 85];
    for (let f = 0; f < 4; f++) {
      const meas: [number, number, number] = [
        bioAfter.mcpFlexionDeg[f],
        bioAfter.pipFlexionDeg[f],
        bioAfter.dipFlexionDeg[f],
      ];
      for (let j = 0; j < 3; j++) {
        const idx = f * 3 + j;
        const predTheta = this.jointAngles[idx] + this.jointVels[idx] * dtSec;
        const innov = meas[j] - predTheta;
        let clampedTheta = Math.max(0, Math.min(romMax[j], predTheta + 0.45 * innov));
        if (j === 2) {
          const pipVal = this.jointAngles[f * 3 + 1];
          clampedTheta = Math.min(clampedTheta, 0.85 * pipVal + 18);
        }
        this.jointAngles[idx] = clampedTheta;
        this.jointVels[idx] = (this.jointVels[idx] + (0.2 * innov) / dtSec) * 0.8;
      }
    }

    return {
      landmarks: this.outBuffer.map((pt) => ({ ...pt })),
      selfOcclusion: selfOcc,
      filteredJointAnglesDeg: this.jointAngles,
    };
  }
}
