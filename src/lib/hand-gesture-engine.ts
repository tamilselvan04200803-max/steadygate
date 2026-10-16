import { HandLandmark2D, HandParameters, RecognizedGesture, UserProfile } from "./types";
import {
  computePalmOrientation,
  isNaturalSideProfileFreeHand as checkNaturalSideProfileFreeHand,
} from "./biomechanics/palm-orientation";
import { resolveLocaleGesture } from "./locales/gesture-packs";
import { normalizeFingerROM, projectOntoTorsoGravity } from "./biomechanics/rom-gravity-normalizer";
import type {
  CaregiverBiometricVerdict,
  LocaleGestureResolution,
  PalmOrientation,
  UserAnatomicalCalibration,
} from "../../.swarm/contracts/types";

/**
 * Default Smart Home mapping for all 10 supported gestures:
 */
export const GESTURE_SMART_HOME_MAP: Record<
  RecognizedGesture,
  { action: string; applianceCategory: string; description: string; icon: string }
> = {
  FIST: {
    action: "TOGGLE_POWER",
    applianceCategory: "High-Ampere Heating (9.1A / 2000W)",
    description: "Easy Long-Hold Gesture: Turn Radiant Quartz Space Heater ON / OFF",
    icon: "✊",
  },
  OPEN_PALM: {
    action: "TOGGLE_FAN_POWER",
    applianceCategory: "Climate / Fan (0.2A / 42W)",
    description: "Turn Study Turbo Breeze Fan ON (Speed 2) / OFF",
    icon: "✋",
  },
  THUMBS_UP: {
    action: "TOGGLE_POWER",
    applianceCategory: "High-Ampere Climate (5.7A / 1250W)",
    description: "Easy Long-Hold Gesture: Turn Living Room Dual-Inverter AC ON / OFF",
    icon: "👍",
  },
  CALL_ME: {
    action: "TOGGLE_POWER",
    applianceCategory: "High-Ampere Water Boiler (13.6A / 3000W)",
    description: "Easy Long-Hold Gesture: Turn Smart Water Boiler / Geyser ON / OFF",
    icon: "🤙",
  },
  POINTING_UP: {
    action: "TOGGLE_POWER",
    applianceCategory: "Lighting (0.05A / 12W)",
    description: "Turn Study Reading Lamp ON (85% Lux) / OFF",
    icon: "☝️",
  },
  VICTORY: {
    action: "TOGGLE_POWER",
    applianceCategory: "Media (0.5A / 110W)",
    description: "Turn Living Room 65\" Smart Display TV ON / OFF",
    icon: "✌️",
  },
  PINCH: {
    action: "TOGGLE_POWER",
    applianceCategory: "Shades (0.07A / 15W)",
    description: "Open / Close Motorized Privacy Blinds",
    icon: "👌",
  },
  THREE_FINGERS: {
    action: "CYCLE_FAN_SPEED",
    applianceCategory: "Climate / Fan Speed",
    description: "Step Fan Speed (1 → 2 → 3 → 4)",
    icon: "🤟",
  },
  FOUR_FINGERS: {
    action: "TOGGLE_POWER",
    applianceCategory: "Security / Deadbolt",
    description: "Lock / Unlock Main Entrance Deadbolt",
    icon: "🖖",
  },
  THUMBS_DOWN: {
    action: "EMERGENCY_STOP_ALL",
    applianceCategory: "Safety / All Off",
    description: "Turn OFF High-Current Appliances",
    icon: "👎",
  },
  UNKNOWN: {
    action: "IDLE",
    applianceCategory: "None",
    description: "Unrecognized transition, object grasp, or hand at rest",
    icon: "❓",
  },
};

/**
 * Empirical Multi-Feature Prototypes calibrated on N = 17,213 real human hand
 * MediaPipe 21-landmark samples from the HaGRID dataset.
 */
export const HAGRID_TRAINED_PROTOTYPES: Record<
  Exclude<RecognizedGesture, "UNKNOWN">,
  {
    flexionCentroid: [number, number, number, number, number];
    pinchNormMedian: number;
    d4_9Median: number;
    sampleCount: number;
  }
> = {
  FIST: {
    flexionCentroid: [0.18, 0.03, 0.04, 0.05, 0.04],
    pinchNormMedian: 0.36,
    d4_9Median: 0.32,
    sampleCount: 945,
  },
  OPEN_PALM: {
    flexionCentroid: [0.74, 0.95, 0.95, 0.97, 0.91],
    pinchNormMedian: 1.16,
    d4_9Median: 1.02,
    sampleCount: 1649,
  },
  THUMBS_UP: {
    flexionCentroid: [0.83, 0.05, 0.04, 0.03, 0.03],
    pinchNormMedian: 0.98,
    d4_9Median: 1.18,
    sampleCount: 1436,
  },
  THUMBS_DOWN: {
    flexionCentroid: [0.88, 0.05, 0.06, 0.05, 0.05],
    pinchNormMedian: 0.87,
    d4_9Median: 1.17,
    sampleCount: 1295,
  },
  CALL_ME: {
    flexionCentroid: [0.63, 0.08, 0.07, 0.06, 0.99],
    pinchNormMedian: 1.0,
    d4_9Median: 0.91,
    sampleCount: 1506,
  },
  POINTING_UP: {
    flexionCentroid: [0.29, 1.0, 0.06, 0.07, 0.06],
    pinchNormMedian: 1.05,
    d4_9Median: 0.21,
    sampleCount: 1263,
  },
  VICTORY: {
    flexionCentroid: [0.4, 0.99, 0.97, 0.05, 0.05],
    pinchNormMedian: 1.08,
    d4_9Median: 0.21,
    sampleCount: 2784,
  },
  PINCH: {
    flexionCentroid: [0.54, 0.13, 0.95, 0.99, 0.95],
    pinchNormMedian: 0.16,
    d4_9Median: 0.79,
    sampleCount: 1592,
  },
  THREE_FINGERS: {
    flexionCentroid: [0.62, 0.98, 0.98, 0.52, 0.05],
    pinchNormMedian: 1.24,
    d4_9Median: 0.71,
    sampleCount: 3109,
  },
  FOUR_FINGERS: {
    flexionCentroid: [0.33, 0.96, 0.96, 0.97, 0.91],
    pinchNormMedian: 1.15,
    d4_9Median: 0.28,
    sampleCount: 1634,
  },
};

export interface AdminGesturePrototype {
  gesture: Exclude<RecognizedGesture, "UNKNOWN">;
  centroid: [number, number, number, number, number];
  pinchNormMedian: number;
  d4_9Median: number;
  sampleCount: number;
  lowLightSamples: number;
  glareSamples: number;
  meanLuminance: number;
  meanContrast: number;
  confidenceBoost: number;
}

export interface AdminNegativeGraspSignature {
  id: string;
  label: string;
  centroid: [number, number, number, number, number];
  cApertureRatio: number;
  luminance: number;
  createdAt: string;
}

export interface AdminTrainedModelState {
  version: number;
  updatedAt: string;
  totalSamplesTrained: number;
  hagridCalibratedCount: number;
  gesturePrototypes: Partial<Record<Exclude<RecognizedGesture, "UNKNOWN">, AdminGesturePrototype>>;
  negativeGraspSignatures: AdminNegativeGraspSignature[];
  environmentalWeights: {
    lowLightGammaGain: number;
    glareCompressionGain: number;
    clutterMarginBonus: number;
    adaptedErrorReductionPct: number;
  };
}

let activeAdminModel: AdminTrainedModelState = {
  version: 2,
  updatedAt: new Date().toISOString(),
  totalSamplesTrained: 17213,
  hagridCalibratedCount: 17213,
  gesturePrototypes: {},
  negativeGraspSignatures: [],
  environmentalWeights: {
    lowLightGammaGain: 1.35,
    glareCompressionGain: 1.2,
    clutterMarginBonus: 0.06,
    adaptedErrorReductionPct: 91.4,
  },
};

export function setAdminTrainedModel(model: AdminTrainedModelState): void {
  activeAdminModel = model;
}

export function getAdminTrainedModel(): AdminTrainedModelState {
  return activeAdminModel;
}

export type ObjectGraspRejectionReason =
  | "NONE"
  | "BOOK_OR_OBJECT_GRASP"
  | "LUMBRICAL_BOOK_CLAMP"
  | "OPEN_BOOK_PAGE_HOLD"
  | "CYLINDRICAL_CUP_OR_PHONE_GRASP"
  | "PALM_OCCLUDED_BY_OBJECT"
  | "ADMIN_LEARNED_NEGATIVE_GRASP"
  | "WIDE_PHONE_OR_OBJECT_CLASP"
  | "CASUAL_FACE_TOUCH_OR_SCRATCH";

export interface ObjectGraspAnalysis {
  isObjectGrasp: boolean;
  reason: ObjectGraspRejectionReason;
  bimodalityScore: number; // 0..1 (high = clear intentional gesture, low = uniform semi-flexed object grasp)
  cApertureRatio: number; // dist(thumbTip, indexTip) / palmLength
  lumbricalFlatness: number; // straightness - wristReach
  faceOverlapDetected?: boolean;
}

function dist(p1: HandLandmark2D, p2: HandLandmark2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function angleAt(a: HandLandmark2D, b: HandLandmark2D, c: HandLandmark2D): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const d = v1x * v2x + v1y * v2y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, d / m))) * 180) / Math.PI;
}

/**
 * Extracts scale- and rotation-invariant hand morphology and 5 finger extension ratios.
 * Incorporates foreshortening-invariant tip-over-PIP ratio so curled fingers viewed
 * sideways in 2D projection never appear falsely extended.
 */
export function extractHandParameters(landmarks: HandLandmark2D[]): HandParameters {
  if (!landmarks || landmarks.length < 21) {
    return {
      palmWidth: 0.2,
      palmLength: 0.25,
      spanRatio: 1.0,
      fingerFlexion: [0.5, 0.5, 0.5, 0.5, 0.5],
      aspectRatio: 1.25,
      tiltAngleDeg: 0,
    };
  }

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const pinkyMcp = landmarks[17];
  const pinkyTip = landmarks[20];

  const palmWidth = dist(indexMcp, pinkyMcp);
  const palmLength = dist(wrist, middleMcp);
  const span = dist(thumbTip, pinkyTip);
  const spanRatio = palmWidth > 0 ? span / palmWidth : 1.0;
  const aspectRatio = palmWidth > 0 ? palmLength / palmWidth : 1.25;

  const angleRad = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
  const tiltAngleDeg = Math.round((angleRad * 180) / Math.PI + 90);

  const baseScale = Math.max(palmLength, palmWidth * 0.85, 1e-5);

  const fingerExt = (mcp: number, pip: number, tip: number, lo: number, spanVal: number) => {
    const s = clamp01((angleAt(landmarks[mcp], landmarks[pip], landmarks[tip]) - 100) / 65);
    const wristReach = clamp01((dist(wrist, landmarks[tip]) / baseScale - lo) / spanVal);
    const foldBack = clamp01(dist(landmarks[mcp], landmarks[tip]) / baseScale / 0.9);
    const r = 0.6 * wristReach + 0.4 * foldBack;
    const base = 0.45 * r + 0.55 * s;
    const pipDist = Math.max(dist(wrist, landmarks[pip]), 1e-5);
    const ratio = dist(wrist, landmarks[tip]) / pipDist;
    const mcpPipDist = Math.max(dist(landmarks[mcp], landmarks[pip]), 1e-5);
    const mcpRatio = dist(landmarks[mcp], landmarks[tip]) / mcpPipDist;
    if (ratio < 1.16 || mcpRatio < 1.25) {
      const topW = clamp01((ratio - 0.84) / 0.32);
      const topM = clamp01((mcpRatio - 0.75) / 0.55);
      const top = Math.min(topW, topM);
      return base * (0.15 + 0.85 * top);
    }
    return base;
  };

  const indexExt = fingerExt(5, 6, 8, 1.1, 0.9);
  const middleExt = fingerExt(9, 10, 12, 1.15, 0.95);
  const ringExt = fingerExt(13, 14, 16, 1.05, 0.85);
  const pinkyExt = fingerExt(17, 20 - 2, 20, 0.95, 0.75);

  const thumbStraight = clamp01((angleAt(landmarks[2], landmarks[3], landmarks[4]) - 120) / 50);
  const thumbAbduct = clamp01((dist(thumbTip, indexMcp) / baseScale - 0.35) / 0.55);
  const thumbReach = clamp01((dist(wrist, thumbTip) / baseScale - 0.9) / 0.8);
  const thumbExt = 0.4 * thumbStraight + 0.35 * thumbAbduct + 0.25 * thumbReach;

  return {
    palmWidth: Math.round(palmWidth * 1000) / 1000,
    palmLength: Math.round(palmLength * 1000) / 1000,
    spanRatio: Math.round(spanRatio * 100) / 100,
    fingerFlexion: [thumbExt, indexExt, middleExt, ringExt, pinkyExt],
    aspectRatio: Math.round(aspectRatio * 100) / 100,
    tiltAngleDeg,
  };
}

/**
 * Strict Object-Grasp Guard:
 * Detects when the user is holding a book (by spine or open cover), phone, or mug/cup,
 * or when an object occludes the palm, preventing false gesture triggers.
 */
export function detectObjectGrasp(
  landmarks: HandLandmark2D[],
  handParams?: HandParameters,
  options?: {
    faceOverlapDetected?: boolean;
    webcamMode?: boolean;
    foreignObjectDetected?: boolean;
  }
): ObjectGraspAnalysis {
  if (!landmarks || landmarks.length < 21) {
    return {
      isObjectGrasp: false,
      reason: "NONE",
      bimodalityScore: 0,
      cApertureRatio: 0,
      lumbricalFlatness: 0,
    };
  }

  const params = handParams || extractHandParameters(landmarks);
  const [thumb, idx, mid, rng, pnk] = params.fingerFlexion;
  const wrist = landmarks[0];
  const palmLen = Math.max(dist(wrist, landmarks[9]), 1e-5);
  const palmWidth = Math.max(dist(landmarks[5], landmarks[17]), 1e-5);
  const aspect = palmLen / palmWidth;

  const pinchNorm = dist(landmarks[4], landmarks[8]) / palmLen;
  const d4_5 = dist(landmarks[4], landmarks[5]) / palmLen;
  const d4_9 = dist(landmarks[4], landmarks[9]) / palmLen;
  const d4_10 = dist(landmarks[4], landmarks[10]) / palmLen;
  const d4_14 = dist(landmarks[4], landmarks[14]) / palmLen;
  const four = [idx, mid, rng, pnk];
  const fourMean = (idx + mid + rng + pnk) / 4.0;
  const fourMax = Math.max(...four);
  const fourMin = Math.min(...four);

  // Measure how bimodal/decisive the 4 fingers are (0 = all hovering at 0.35, 1 = all at 0 or 1)
  const bimodalityScore =
    four.reduce((acc, v) => acc + Math.min(1, Math.abs(v - 0.36) / 0.34), 0) / 4.0;

  const sIdx = clamp01((angleAt(landmarks[5], landmarks[6], landmarks[8]) - 100) / 65);
  const sMid = clamp01((angleAt(landmarks[9], landmarks[10], landmarks[12]) - 100) / 65);
  const sRng = clamp01((angleAt(landmarks[13], landmarks[14], landmarks[16]) - 100) / 65);
  const sPnk = clamp01((angleAt(landmarks[17], landmarks[18], landmarks[20]) - 100) / 65);
  const meanStraight = (sIdx + sMid + sRng + sPnk) / 4.0;

  const wrIdx = clamp01((dist(wrist, landmarks[8]) / palmLen - 1.1) / 0.9);
  const wrMid = clamp01((dist(wrist, landmarks[12]) / palmLen - 1.15) / 0.95);
  const wrRng = clamp01((dist(wrist, landmarks[16]) / palmLen - 1.05) / 0.85);
  const wrPnk = clamp01((dist(wrist, landmarks[20]) / palmLen - 0.95) / 0.75);
  const meanWristReach = (wrIdx + wrMid + wrRng + wrPnk) / 4.0;
  const lumbricalFlatness = Math.max(0, meanStraight - meanWristReach);

  // 0. Check Admin-Learned Negative Grasp Signatures (e.g., admin recorded holding a book/phone/mug)
  if (!options?.webcamMode && activeAdminModel.negativeGraspSignatures.length > 0) {
    const liveVec = [thumb, idx, mid, rng, pnk];
    for (const neg of activeAdminModel.negativeGraspSignatures) {
      if (Array.isArray(neg.centroid) && neg.centroid.length === 5) {
        const l1 =
          liveVec.reduce((acc, v, i) => acc + Math.abs(v - neg.centroid[i]), 0) / 5.0;
        const apDiff = Math.abs(pinchNorm - (neg.cApertureRatio || pinchNorm));
        if (l1 <= 0.11 && apDiff <= 0.25) {
          return {
            isObjectGrasp: true,
            reason: "ADMIN_LEARNED_NEGATIVE_GRASP",
            bimodalityScore: Math.round(bimodalityScore * 100) / 100,
            cApertureRatio: Math.round(pinchNorm * 100) / 100,
            lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
          };
        }
      }
    }
  }

  const mIdx = angleAt(wrist, landmarks[5], landmarks[6]);
  const mMid = angleAt(wrist, landmarks[9], landmarks[10]);
  const mRng = angleAt(wrist, landmarks[13], landmarks[14]);
  const mPnk = angleAt(wrist, landmarks[17], landmarks[18]);
  const meanMcpAngle = (mIdx + mMid + mRng + mPnk) / 4.0;

  // 6. Wide Smartphone / Tablet / Object Clasp with Index Extended (Failure Case 1: Screenshot 114707):
  // Thumb tip (4) opposes the MCP/PIP knuckle line across the wide body of a phone/book
  // (d4_5 > 0.72, d4_10 > 1.10, d4_14 > 1.10) while middle/ring/pinky hook around the side edge
  // even when the index finger rests extended along the top edge of the phone.
  if (
    idx >= 0.50 &&
    Math.max(mid, rng, pnk) < 0.45 &&
    d4_5 > 0.72 &&
    d4_10 > 1.10 &&
    d4_14 > 1.10
  ) {
    return {
      isObjectGrasp: true,
      reason: "WIDE_PHONE_OR_OBJECT_CLASP",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 7. Casual Face/Nose Touch or Scratch Guard (Failure Case 3: Screenshot 121013):
  // Dual guard: (a) Biomechanical dorsal/claw scratch where knuckles are elevated near nose bridge
  // with acute MCP fold (< 45 deg) while straight PIP-DIP segments (> 0.65) hang downward toward the wrist,
  // OR (b) Live Face/Nose ROI overlap flagged by the camera stream.
  const isBiomechanicalFaceScratch =
    thumb < 0.48 &&
    d4_9 < 0.68 &&
    Math.min(mIdx, mMid) < 45 &&
    Math.max(sIdx, sMid) > 0.65 &&
    landmarks[6].y > landmarks[5].y &&
    landmarks[8].y > landmarks[6].y &&
    fourMean < 0.35;

  if (isBiomechanicalFaceScratch || options?.faceOverlapDetected) {
    return {
      isObjectGrasp: true,
      reason: "CASUAL_FACE_TOUCH_OR_SCRATCH",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
      faceOverlapDetected: Boolean(options?.faceOverlapDetected || isBiomechanicalFaceScratch),
    };
  }

  // On the live webcam, never guess "object grasp" from 2D finger flexion alone unless
  // photometric verification confirms a foreign physical object inside the hand aperture.
  if (options?.webcamMode && !options?.foreignObjectDetected) {
    return {
      isObjectGrasp: false,
      reason: "NONE",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 1. Palm occluded or collapsed by a large held object (book cover blocking palm)
  // Exempt natural 3D rotated/tilted free hands (S1: intact proximal bones & non-degenerate geometry).
  const isNaturalSideProfileFreeHand = checkNaturalSideProfileFreeHand(
    landmarks,
    params.fingerFlexion
  );

  if ((aspect < 0.38 || aspect > 3.6) && !isNaturalSideProfileFreeHand) {
    return {
      isObjectGrasp: true,
      reason: "PALM_OCCLUDED_BY_OBJECT",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 3. Lumbrical book-edge C-clamp: MCP joints bent/flexed (< 145 deg) around book edge
  // while PIP-DIP-Tip segments extend straight along book cover
  const dIdx = dist(landmarks[8], landmarks[5]) / palmLen;
  const dMid = dist(landmarks[12], landmarks[9]) / palmLen;
  const dRng = dist(landmarks[16], landmarks[13]) / palmLen;
  const dPnk = dist(landmarks[20], landmarks[17]) / palmLen;
  const minTipToMcp = Math.min(dIdx, dMid, dRng, dPnk);
  const isRotatedSideHand =
    aspect > 2.2 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.22 && fourMin >= 0.65;

  if (
    !isRotatedSideHand &&
    meanStraight > 0.65 &&
    meanMcpAngle < 145 &&
    minTipToMcp > 0.55 &&
    pinchNorm > 0.35
  ) {
    return {
      isObjectGrasp: true,
      reason: "LUMBRICAL_BOOK_CLAMP",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 5. Cylindrical cup/mug or phone side-clamp: fingertips held out from MCPs with C-aperture
  const tipToMcpMean =
    (dist(landmarks[8], landmarks[5]) +
      dist(landmarks[12], landmarks[9]) +
      dist(landmarks[16], landmarks[13]) +
      dist(landmarks[20], landmarks[17])) /
    (4.0 * palmLen);
  if (
    fourMean >= 0.16 &&
    fourMean <= 0.46 &&
    fourMax < 0.52 &&
    tipToMcpMean > 0.52 &&
    pinchNorm >= 0.42 &&
    pinchNorm <= 1.15
  ) {
    return {
      isObjectGrasp: true,
      reason: "CYLINDRICAL_CUP_OR_PHONE_GRASP",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 4. Open-book thumb-on-page hold: thumb pressing front page while 4 fingers support back cover
  if (
    thumb >= 0.4 &&
    thumb <= 0.88 &&
    fourMean >= 0.16 &&
    fourMean <= 0.56 &&
    fourMin >= 0.12 &&
    fourMax < 0.64 &&
    fourMax - fourMin < 0.24
  ) {
    return {
      isObjectGrasp: true,
      reason: "OPEN_BOOK_PAGE_HOLD",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  // 2. Book-spine / half-curled object grasp shelf (general catch-all fallback):
  // If >= 2 fingers sit in the semi-flexed grasp band [0.22, 0.58] with no finger fully extended (< 0.62)
  // and no precision pinch contact, it is an object grasp (e.g. holding a book/phone/mug) or mid-transition
  const semiFlexedCount = four.filter((v) => v >= 0.22 && v <= 0.58).length;
  if (semiFlexedCount >= 2 && fourMax < 0.62 && pinchNorm > 0.24) {
    return {
      isObjectGrasp: true,
      reason: "BOOK_OR_OBJECT_GRASP",
      bimodalityScore: Math.round(bimodalityScore * 100) / 100,
      cApertureRatio: Math.round(pinchNorm * 100) / 100,
      lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
    };
  }

  return {
    isObjectGrasp: false,
    reason: "NONE",
    bimodalityScore: Math.round(bimodalityScore * 100) / 100,
    cApertureRatio: Math.round(pinchNorm * 100) / 100,
    lumbricalFlatness: Math.round(lumbricalFlatness * 100) / 100,
  };
}

/**
 * Subagent S5 — Scale-Invariant Anatomical Bone-Ratio Signature & Caregiver Hand Rejector
 * Computes 3 scale-invariant bone ratios:
 *  R1 = d(0,9) / d(5,17) (palm length-to-width ratio)
 *  R2 = (d(5,6)+d(6,7)+d(7,8)) / d(0,9) (index bone chain to palm length)
 *  R3 = (d(17,18)+d(18,19)+d(19,20)) / (d(9,10)+d(10,11)+d(11,12)) (pinky-to-middle bone chain ratio)
 */
export function computeBoneRatioSignature(
  landmarks: HandLandmark2D[]
): [number, number, number] {
  if (!landmarks || landmarks.length < 21) {
    return [1.25, 0.88, 0.76];
  }
  const palmLen = Math.max(dist(landmarks[0], landmarks[9]), 1e-4);
  const palmWid = Math.max(dist(landmarks[5], landmarks[17]), 1e-4);
  const idxChain =
    dist(landmarks[5], landmarks[6]) +
    dist(landmarks[6], landmarks[7]) +
    dist(landmarks[7], landmarks[8]);
  const midChain = Math.max(
    dist(landmarks[9], landmarks[10]) +
      dist(landmarks[10], landmarks[11]) +
      dist(landmarks[11], landmarks[12]),
    1e-4
  );
  const pnkChain =
    dist(landmarks[17], landmarks[18]) +
    dist(landmarks[18], landmarks[19]) +
    dist(landmarks[19], landmarks[20]);

  return [
    Math.round((palmLen / palmWid) * 1000) / 1000,
    Math.round((idxChain / palmLen) * 1000) / 1000,
    Math.round((pnkChain / midChain) * 1000) / 1000,
  ];
}

/**
 * Verifies that a newly detected hand belongs to the enrolled patient rather than a
 * caregiver or bystander reaching across the camera frame.
 */
export function verifyUserHandBiometrics(
  landmarks: HandLandmark2D[],
  enrolledProfile?: {
    boneRatios: [number, number, number];
    lastWrist?: { x: number; y: number };
  } | null
): CaregiverBiometricVerdict {
  if (!enrolledProfile || !landmarks || landmarks.length < 21) {
    return {
      verified: true,
      reason: "VERIFIED_USER_HAND",
      wristJumpDelta: 0,
      boneRatioDeviation: 0,
    };
  }

  const liveRatios = computeBoneRatioSignature(landmarks);
  const wristJumpDelta = enrolledProfile.lastWrist
    ? Math.hypot(
        landmarks[0].x - enrolledProfile.lastWrist.x,
        landmarks[0].y - enrolledProfile.lastWrist.y
      )
    : 0;

  let relDiffSum = 0;
  for (let i = 0; i < 3; i++) {
    const base = Math.max(0.05, enrolledProfile.boneRatios[i]);
    relDiffSum += Math.abs(liveRatios[i] - base) / base;
  }
  const boneRatioDeviation = Math.round((relDiffSum / 3) * 10000) / 100;

  if (wristJumpDelta > 0.25 && boneRatioDeviation > 18.0) {
    return {
      verified: false,
      reason: "CAREGIVER_OR_BYSTANDER_HAND_IGNORED",
      wristJumpDelta: Math.round(wristJumpDelta * 1000) / 1000,
      boneRatioDeviation,
    };
  }

  return {
    verified: true,
    reason: "VERIFIED_USER_HAND",
    wristJumpDelta: Math.round(wristJumpDelta * 1000) / 1000,
    boneRatioDeviation,
  };
}

/**
 * Real-time gesture classification calibrated on N = 17,213 real HaGRID samples
 * with Strict Object-Grasp Rejection, 3D Palmar/Dorsal Orientation (S1),
 * ISO-3166 Cultural Locale Remapping (S2), Contracture ROM & Bed-Incline Normalization (S3),
 * and Caregiver Biometric Rejection (S5).
 */
export function classifyHandGesture(
  landmarks: HandLandmark2D[],
  userProfile?: UserProfile | null,
  options?: {
    faceOverlapDetected?: boolean;
    webcamMode?: boolean;
    foreignObjectDetected?: boolean;
    handedness?: "Left" | "Right";
    localeCountryCode?: string;
    userCalib?: Partial<UserAnatomicalCalibration> | null;
    enrolledBiometrics?: {
      boneRatios: [number, number, number];
      lastWrist?: { x: number; y: number };
    } | null;
  }
): {
  gesture: RecognizedGesture;
  confidence: number;
  top2Gesture: RecognizedGesture;
  margin: number;
  handParams: HandParameters;
  fingerStates: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  personalizedBoostApplied: boolean;
  objectGraspAnalysis?: ObjectGraspAnalysis;
  palmOrientation?: PalmOrientation;
  localeResolution?: LocaleGestureResolution;
  biometricVerdict?: CaregiverBiometricVerdict;
} {
  const handParams = extractHandParameters(landmarks);
  const normalizedFlexion = options?.userCalib
    ? normalizeFingerROM(handParams.fingerFlexion, options.userCalib)
    : handParams.fingerFlexion;
  const [thumb, index, middle, ring, pinky] = normalizedFlexion;
  if (options?.userCalib) {
    handParams.fingerFlexion = normalizedFlexion;
  }

  const flexScale = userProfile?.fingerFlexibility || 1.0;
  const extendThreshold = 0.52 * flexScale;

  const fingerStates = {
    thumb: thumb >= extendThreshold,
    index: index >= extendThreshold,
    middle: middle >= extendThreshold,
    ring: ring >= extendThreshold,
    pinky: pinky >= extendThreshold,
  };

  if (!landmarks || landmarks.length < 21) {
    return {
      gesture: "UNKNOWN",
      confidence: 0.1,
      top2Gesture: "UNKNOWN",
      margin: 0,
      handParams,
      fingerStates,
      personalizedBoostApplied: false,
    };
  }

  const palmOrientation = computePalmOrientation(landmarks, options?.handedness || "Right");
  const biometricVerdict = verifyUserHandBiometrics(landmarks, options?.enrolledBiometrics);

  if (!biometricVerdict.verified) {
    return {
      gesture: "UNKNOWN",
      confidence: 0.1,
      top2Gesture: "UNKNOWN",
      margin: 0,
      handParams,
      fingerStates,
      personalizedBoostApplied: false,
      palmOrientation,
      biometricVerdict,
    };
  }

  // Strict Object-Grasp & Book-Holding Guard
  const graspAnalysis = detectObjectGrasp(landmarks, handParams, options);
  if (graspAnalysis.isObjectGrasp) {
    return {
      gesture: "UNKNOWN",
      confidence: 0.12,
      top2Gesture: "FIST",
      margin: 0,
      handParams,
      fingerStates,
      personalizedBoostApplied: false,
      objectGraspAnalysis: graspAnalysis,
      palmOrientation,
      biometricVerdict,
    };
  }

  const wrist = landmarks[0];
  const palmLen = Math.max(dist(wrist, landmarks[9]), 1e-5);
  const pinchNorm = dist(landmarks[4], landmarks[8]) / palmLen;
  const d4_9 = dist(landmarks[4], landmarks[9]) / palmLen;
  const d4_13 = dist(landmarks[4], landmarks[13]) / palmLen;
  const d4_6 = dist(landmarks[4], landmarks[6]) / palmLen;
  const d4_10 = dist(landmarks[4], landmarks[10]) / palmLen;

  const bedTiltDeg = options?.userCalib?.bedTiltDeg ?? 0;
  const thVec = projectOntoTorsoGravity(
    (landmarks[5].x - landmarks[4].x) / palmLen,
    (landmarks[5].y - landmarks[4].y) / palmLen,
    bedTiltDeg
  );
  const wristVec = projectOntoTorsoGravity(
    (wrist.x - landmarks[4].x) / palmLen,
    (wrist.y - landmarks[4].y) / palmLen,
    bedTiltDeg
  );
  const thDy = thVec.y;
  const wristDy = wristVec.y;

  const fourMean = (index + middle + ring + pinky) / 4.0;
  const fourMax = Math.max(index, middle, ring, pinky);
  const threeMrp = (middle + ring + pinky) / 3.0;
  const threeImr = (index + middle + ring) / 3.0;

  const scores: Record<RecognizedGesture, number> = {
    OPEN_PALM: 0.1,
    THUMBS_UP: 0.1,
    VICTORY: 0.1,
    POINTING_UP: 0.1,
    FIST: 0.1,
    THUMBS_DOWN: 0.1,
    PINCH: 0.1,
    CALL_ME: 0.1,
    THREE_FINGERS: 0.1,
    FOUR_FINGERS: 0.1,
    UNKNOWN: 0.15,
  };

  // 1. PINCH (OK sign with 3 fingers extended OR precision pinch with 3 fingers curled)
  if (
    pinchNorm < 0.36 &&
    (threeMrp > 0.45 ||
      (pinchNorm < 0.22 &&
        thumb >= 0.3 &&
        d4_6 > 0.32 &&
        middle < 0.38 &&
        ring < 0.38 &&
        pinky < 0.38))
  ) {
    const contactQuality = clamp01(1.0 - pinchNorm / 0.38);
    const ringBonus = threeMrp > 0.45 ? threeMrp : 1.0 - threeMrp;
    scores.PINCH = Math.min(0.98, 0.72 + 0.18 * contactQuality + 0.08 * ringBonus);
  }

  // 2. CALL_ME (Shaka: Pinky extended + Thumb abducted, Index/Middle/Ring curled)
  if (
    pinky > 0.45 &&
    Math.max(index, middle, ring) < 0.42 &&
    (thumb > 0.25 || d4_9 > 0.42 || d4_13 > 0.52)
  ) {
    const callCurled = 1.0 - (index + middle + ring) / 3.0;
    const callOpen = (pinky + Math.min(1, Math.max(thumb, d4_9 * 0.85))) / 2.0;
    scores.CALL_ME = Math.min(0.97, 0.65 + 0.18 * callOpen + 0.14 * callCurled);
  }

  // 3. POINTING_UP (Index extended, Middle/Ring/Pinky curled)
  if (index > 0.5 && Math.max(middle, ring, pinky) < 0.42 && scores.PINCH < 0.6) {
    const pointCurled = 1.0 - (middle + ring + pinky) / 3.0;
    scores.POINTING_UP = Math.min(0.97, 0.64 + 0.2 * index + 0.13 * pointCurled);
  }

  // 4. VICTORY vs THREE_FINGERS (three2 = Thumb + Index + Middle extended, Ring + Pinky curled)
  if (index > 0.5 && middle > 0.5 && Math.max(ring, pinky) < 0.42) {
    const twoOpen = (index + middle) / 2.0;
    const twoCurled = 1.0 - (ring + pinky) / 2.0;
    if (d4_9 > 0.62 && d4_13 > 0.72) {
      scores.THREE_FINGERS = Math.min(0.97, 0.66 + 0.18 * twoOpen + 0.13 * twoCurled);
    } else {
      scores.VICTORY = Math.min(0.97, 0.66 + 0.18 * twoOpen + 0.13 * twoCurled);
    }
  }

  // 5. THREE_FINGERS (classic Index + Middle + Ring extended, Pinky curled)
  if (
    index > 0.5 &&
    middle > 0.5 &&
    ring > 0.5 &&
    (pinky < 0.46 || (pinky < 0.62 && threeImr - pinky > 0.28)) &&
    scores.PINCH < 0.6
  ) {
    scores.THREE_FINGERS = Math.max(
      scores.THREE_FINGERS,
      Math.min(0.97, 0.65 + 0.2 * threeImr + 0.12 * (1.0 - pinky))
    );
  }

  // 6. FOUR_FINGERS vs OPEN_PALM (all 4 fingers extended)
  const openGate = options?.webcamMode ? 0.44 : 0.52;
  const pinkyOpenGate = options?.webcamMode ? 0.40 : 0.46;
  if (
    index > openGate &&
    middle > openGate &&
    ring > openGate &&
    pinky > pinkyOpenGate &&
    !(pinky < 0.62 && threeImr - pinky > 0.28) &&
    scores.PINCH < 0.6
  ) {
    if (d4_9 < 0.54 || d4_13 < 0.58 || thumb < 0.38) {
      const thumbTucked = clamp01(1.0 - Math.min(thumb, d4_9));
      scores.FOUR_FINGERS = Math.min(0.97, 0.66 + 0.2 * fourMean + 0.11 * thumbTucked);
      scores.OPEN_PALM = 0.35;
    } else {
      const allFive = (thumb + index + middle + ring + pinky) / 5.0;
      scores.OPEN_PALM = Math.min(0.97, 0.66 + 0.3 * allFive);
      scores.FOUR_FINGERS = 0.32;
    }
  }

  // 7. Curled 4 fingers: FIST vs THUMBS_UP vs THUMBS_DOWN
  const curlMeanGate = options?.webcamMode ? 0.35 : 0.32;
  const curlMaxGate = options?.webcamMode ? 0.48 : 0.45;
  if (fourMean < curlMeanGate && fourMax < curlMaxGate && scores.PINCH < 0.6 && scores.CALL_ME < 0.6) {
    const curlQuality = 1.0 - fourMean;
    if (thumb > 0.48 && (d4_9 > 0.72 || d4_10 > 0.68 || d4_6 > 0.55)) {
      if (thDy >= -0.05 && wristDy >= 0.0) {
        scores.THUMBS_UP = Math.min(0.97, 0.65 + 0.18 * curlQuality + 0.14 * clamp01(d4_9 / 1.1));
      } else {
        scores.THUMBS_DOWN = Math.min(
          0.97,
          0.65 + 0.18 * curlQuality + 0.14 * clamp01(d4_9 / 1.1)
        );
      }
    } else {
      scores.FIST = Math.min(0.97, 0.66 + 0.28 * curlQuality);
    }
  }

  // Apply Admin-Trained Environmental & Gesture Prototype Adaptation
  let personalizedBoostApplied = false;
  if (
    activeAdminModel.gesturePrototypes &&
    Object.keys(activeAdminModel.gesturePrototypes).length > 0
  ) {
    const liveVec = [thumb, index, middle, ring, pinky];
    for (const [gestKey, proto] of Object.entries(activeAdminModel.gesturePrototypes)) {
      const key = gestKey as Exclude<RecognizedGesture, "UNKNOWN">;
      if (proto && Array.isArray(proto.centroid) && proto.centroid.length === 5) {
        // Respect thumb vertical direction when distinguishing THUMBS_UP vs THUMBS_DOWN
        if (key === "THUMBS_UP" && !(thDy >= -0.05 && wristDy >= 0.0)) continue;
        if (key === "THUMBS_DOWN" && thDy >= -0.05 && wristDy >= 0.0) continue;

        const meanDiff =
          liveVec.reduce((acc, v, idx) => acc + Math.abs(v - proto.centroid[idx]), 0) / 5.0;
        const d49Diff = Math.abs(d4_9 - (proto.d4_9Median || d4_9));
        if (meanDiff <= 0.16 && d49Diff <= 0.32 && (scores[key] >= 0.45 || meanDiff <= 0.11)) {
          const matchScore =
            0.74 + 0.18 * (1 - meanDiff / 0.16) + 0.06 * Math.min(1, (proto.confidenceBoost || 1) - 0.95);
          scores[key] = Math.min(0.99, Math.max(scores[key], matchScore));
          personalizedBoostApplied = true;
        }
      }
    }
  }

  // Apply Personalized AI Prototype Calibration Boosts & Centroid Matching
  if (userProfile?.personalizedPrototypes) {
    try {
      const prototypes = JSON.parse(userProfile.personalizedPrototypes);
      for (const [gestKey, config] of Object.entries(prototypes)) {
        const key = gestKey as RecognizedGesture;
        if (scores[key] !== undefined && typeof config === "object" && config !== null) {
          const proto = config as {
            confidenceBoost?: number;
            centroid?: [number, number, number, number, number];
            flexTol?: number;
          };
          const boost = proto.confidenceBoost || 1.0;
          if (scores[key] > 0.5) {
            scores[key] *= boost;
          }

          if (Array.isArray(proto.centroid) && proto.centroid.length === 5) {
            const liveVec = [thumb, index, middle, ring, pinky];
            const meanDiff =
              liveVec.reduce((acc, v, idx) => acc + Math.abs(v - proto.centroid![idx]), 0) / 5;
            const tol = proto.flexTol || 0.24;
            if (meanDiff <= tol && scores[key] > 0.5) {
              scores[key] = Math.min(0.99, scores[key] + 0.08 * (1 - meanDiff / tol));
            }
          }
          personalizedBoostApplied = true;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const sorted = Object.entries(scores)
    .filter(([g]) => g !== "UNKNOWN")
    .sort(([, a], [, b]) => b - a)
    .map(([g, score]) => ({
      gesture: g as RecognizedGesture,
      confidence: Math.min(0.99, Math.max(0.1, score)),
    }));

  const top1 = sorted[0] || { gesture: "UNKNOWN" as RecognizedGesture, confidence: 0.1 };
  const top2 = sorted[1] || { gesture: "UNKNOWN" as RecognizedGesture, confidence: 0.1 };
  const margin = Math.max(0, top1.confidence - top2.confidence);

  // Require both strong confidence (>= 0.60) and clear separation margin (>= 0.15)
  const isConfident = top1.confidence >= 0.6 && margin >= 0.15;
  const rawWinner: RecognizedGesture = isConfident ? top1.gesture : "UNKNOWN";

  const localeResolution = resolveLocaleGesture(
    rawWinner,
    palmOrientation,
    options?.localeCountryCode || "US"
  );
  const finalGesture: RecognizedGesture = options?.localeCountryCode
    ? localeResolution.effectiveGesture
    : rawWinner;
  const finalConf =
    finalGesture !== "UNKNOWN"
      ? Math.round(top1.confidence * 100) / 100
      : Math.round(Math.min(0.45, top1.confidence) * 100) / 100;

  return {
    gesture: finalGesture,
    confidence: finalConf,
    top2Gesture: top2.gesture,
    margin: Math.round(margin * 100) / 100,
    handParams,
    fingerStates,
    personalizedBoostApplied,
    objectGraspAnalysis: graspAnalysis,
    palmOrientation,
    localeResolution,
    biometricVerdict,
  };
}

/**
 * Generates realistic negative-control landmarks representing a human hand holding
 * a book, smartphone, mug, or occluded object so reviewers and automated tests can
 * verify 0% false gesture activation.
 */
export function generateObjectGraspLandmarks(
  mode: "BOOK_SPINE" | "OPEN_BOOK" | "PHONE_GRASP" | "CUP_MUG" | "OCCLUDED_BOOK" = "BOOK_SPINE",
  timeSec: number = 0,
  tremorF0Hz: number = 5.2,
  tremorAmp: number = 0.015
): HandLandmark2D[] {
  const cx = 0.5 + tremorAmp * 0.4 * Math.cos(2 * Math.PI * tremorF0Hz * timeSec);
  const cy = 0.55 + tremorAmp * Math.sin(2 * Math.PI * tremorF0Hz * timeSec);
  const wrist: HandLandmark2D = { x: cx, y: cy + 0.18 };

  if (mode === "OCCLUDED_BOOK") {
    // Book covers most of palm so MediaPipe landmarks collapse horizontally into a narrow strip (aspect > 4.0)
    const pts: HandLandmark2D[] = [wrist];
    for (let i = 1; i < 21; i++) {
      pts.push({
        x: cx + (i - 10) * 0.002,
        y: cy - (i / 20) * 0.08,
      });
    }
    return pts;
  }

  // Half-curled fingers (ext ~ 0.36..0.42) clamping a book spine, open book cover, phone, or mug
  const ext =
    mode === "BOOK_SPINE"
      ? 0.4
      : mode === "OPEN_BOOK"
      ? 0.42
      : mode === "PHONE_GRASP"
      ? 0.38
      : 0.36;

  const indexMcp = { x: cx - 0.06, y: cy };
  const middleMcp = { x: cx - 0.01, y: cy - 0.02 };
  const ringMcp = { x: cx + 0.04, y: cy };
  const pinkyMcp = { x: cx + 0.08, y: cy + 0.03 };

  const thumbCmc = { x: cx - 0.09, y: cy + 0.09 };
  const thumbMcp = { x: cx - 0.11, y: cy + 0.04 };
  const thumbIp = { x: cx - 0.12, y: cy - 0.01 };
  const thumbTip =
    mode === "OPEN_BOOK"
      ? { x: cx - 0.15, y: cy - 0.05 }
      : { x: cx - 0.125, y: cy - 0.035 };

  const createGraspFinger = (mcp: HandLandmark2D, angleDeg: number, e: number) => {
    const curl = 1 - e;
    const seg = [0.075, 0.055, 0.045];
    let heading = (angleDeg * Math.PI) / 180;
    const pts: HandLandmark2D[] = [mcp];
    let cur = mcp;
    const bends = [curl * 1.45, curl * 1.15, curl * 0.75];
    for (let i = 0; i < 3; i++) {
      heading += bends[i];
      cur = { x: cur.x + Math.sin(heading) * seg[i], y: cur.y - Math.cos(heading) * seg[i] };
      pts.push(cur);
    }
    return pts;
  };

  return [
    wrist,
    thumbCmc,
    thumbMcp,
    thumbIp,
    thumbTip,
    ...createGraspFinger(indexMcp, -6, ext),
    ...createGraspFinger(middleMcp, 0, ext + 0.01),
    ...createGraspFinger(ringMcp, 6, ext - 0.01),
    ...createGraspFinger(pinkyMcp, 12, ext - 0.02),
  ];
}

/**
 * Generates synthetic realistic 21 hand landmarks for any of the 10 gestures
 * with specified involuntary tremor amplitude and frequency.
 */
export function generateSyntheticGestureLandmarks(
  gesture: RecognizedGesture,
  timeSec: number,
  tremorF0Hz: number = 5.2,
  tremorAmp: number = 0.045
): HandLandmark2D[] {
  const cx = 0.5;
  const cy = 0.55;

  const tremorY = tremorAmp * Math.sin(2 * Math.PI * tremorF0Hz * timeSec);
  const tremorX = tremorAmp * 0.4 * Math.cos(2 * Math.PI * tremorF0Hz * timeSec * 0.9);

  const baseX = cx + tremorX;
  const baseY = cy + tremorY;

  const wrist: HandLandmark2D = { x: baseX, y: baseY + 0.18 };

  let extThumb = 1.0;
  let extIndex = 1.0;
  let extMiddle = 1.0;
  let extRing = 1.0;
  let extPinky = 1.0;
  let thumbUp = false;
  let thumbDown = false;
  let pinchMode = false;

  switch (gesture) {
    case "OPEN_PALM":
      extThumb = 0.95;
      extIndex = 0.98;
      extMiddle = 1.0;
      extRing = 0.96;
      extPinky = 0.92;
      break;
    case "THUMBS_UP":
      extThumb = 0.98;
      thumbUp = true;
      extIndex = 0.15;
      extMiddle = 0.14;
      extRing = 0.12;
      extPinky = 0.1;
      break;
    case "THUMBS_DOWN":
      extThumb = 0.98;
      thumbDown = true;
      extIndex = 0.12;
      extMiddle = 0.1;
      extRing = 0.1;
      extPinky = 0.08;
      break;
    case "VICTORY":
      extThumb = 0.15;
      extIndex = 0.98;
      extMiddle = 0.96;
      extRing = 0.12;
      extPinky = 0.1;
      break;
    case "POINTING_UP":
      extThumb = 0.15;
      extIndex = 1.0;
      extMiddle = 0.12;
      extRing = 0.1;
      extPinky = 0.08;
      break;
    case "FIST":
      extThumb = 0.12;
      extIndex = 0.1;
      extMiddle = 0.09;
      extRing = 0.08;
      extPinky = 0.08;
      break;
    case "PINCH":
      extThumb = 0.5;
      extIndex = 0.5;
      extMiddle = 0.95;
      extRing = 0.96;
      extPinky = 0.94;
      pinchMode = true;
      break;
    case "CALL_ME":
      extThumb = 0.98;
      extIndex = 0.1;
      extMiddle = 0.1;
      extRing = 0.1;
      extPinky = 0.98;
      break;
    case "THREE_FINGERS":
      extThumb = 0.12;
      extIndex = 0.98;
      extMiddle = 0.98;
      extRing = 0.95;
      extPinky = 0.1;
      break;
    case "FOUR_FINGERS":
      extThumb = 0.08;
      extIndex = 0.98;
      extMiddle = 0.98;
      extRing = 0.96;
      extPinky = 0.94;
      break;
    default:
      extThumb = 0.5;
      extIndex = 0.5;
      extMiddle = 0.5;
      extRing = 0.5;
      extPinky = 0.5;
  }

  const indexMcp = { x: baseX - 0.06, y: baseY };
  const middleMcp = { x: baseX - 0.01, y: baseY - 0.02 };
  const ringMcp = { x: baseX + 0.04, y: baseY };
  const pinkyMcp = { x: baseX + 0.08, y: baseY + 0.03 };

  const thumbCmc = { x: baseX - 0.09, y: baseY + 0.09 };
  const thumbMcp = { x: baseX - 0.11, y: baseY + 0.04 };
  const thumbIp = thumbUp
    ? { x: baseX - 0.115, y: baseY - 0.04 }
    : thumbDown
    ? { x: baseX - 0.115, y: baseY + 0.22 }
    : pinchMode
    ? { x: baseX - 0.08, y: baseY - 0.02 }
    : {
        x: baseX - 0.11 - extThumb * 0.035 + (1 - extThumb) * 0.03,
        y: baseY + 0.005 - extThumb * 0.02 + (1 - extThumb) * 0.01,
      };
  const thumbTip = thumbUp
    ? { x: baseX - 0.115, y: baseY - 0.11 }
    : thumbDown
    ? { x: baseX - 0.115, y: baseY + 0.31 }
    : pinchMode
    ? { x: baseX - 0.055, y: baseY - 0.055 }
    : {
        x: baseX - 0.11 - extThumb * 0.075 + (1 - extThumb) * 0.075,
        y: baseY + 0.005 - extThumb * 0.05 + (1 - extThumb) * 0.03,
      };

  const createFinger = (mcp: HandLandmark2D, angleDeg: number, ext: number) => {
    if (pinchMode && mcp === indexMcp) {
      return [
        mcp,
        { x: baseX - 0.06, y: baseY - 0.038 },
        { x: baseX - 0.058, y: baseY - 0.048 },
        { x: baseX - 0.055, y: baseY - 0.055 },
      ];
    }
    const curl = 1 - Math.min(1, Math.max(0, ext));
    const seg = [0.075, 0.055, 0.045];
    let heading = (angleDeg * Math.PI) / 180;
    const pts: HandLandmark2D[] = [mcp];
    let cur = mcp;
    const bends = [curl * 1.75, curl * 1.4, curl * 0.9];
    for (let i = 0; i < 3; i++) {
      heading += bends[i];
      cur = { x: cur.x + Math.sin(heading) * seg[i], y: cur.y - Math.cos(heading) * seg[i] };
      pts.push(cur);
    }
    return pts;
  };

  const indexFinger = createFinger(indexMcp, -8, extIndex);
  const middleFinger = createFinger(middleMcp, 0, extMiddle);
  const ringFinger = createFinger(ringMcp, 8, extRing);
  const pinkyFinger = createFinger(pinkyMcp, 16, extPinky);

  return [
    wrist,
    thumbCmc,
    thumbMcp,
    thumbIp,
    thumbTip,
    ...indexFinger,
    ...middleFinger,
    ...ringFinger,
    ...pinkyFinger,
  ];
}

/**
 * Exact 21-landmark fixtures reconstructed from the 3 live camera screenshots:
 * - CASE_1_PHONE_IN_HAND (`Screenshot 2026-10-16 114707.png`): Smartphone held vertically with index extended along top edge -> must be blocked (`WIDE_PHONE_OR_OBJECT_CLASP` -> `UNKNOWN`).
 * - CASE_2_FREE_HAND_SIDE_PROFILE (`Screenshot 2026-10-16 114648.png`): Free hand viewed in 3D radial side profile -> must NOT trigger `PALM_OCCLUDED_BY_OBJECT` (`isObjectGrasp: false` -> `OPEN_PALM`).
 * - CASE_3_NOSE_TINGLING_SCRATCH (`Screenshot 2026-10-16 121013.png`): Casual nose/face scratching with acute MCP fold & hanging straight PIP segments -> must be blocked (`CASUAL_FACE_TOUCH_OR_SCRATCH` -> `UNKNOWN`).
 */
export const REAL_WORLD_FAILURE_CASES: {
  CASE_1_PHONE_IN_HAND: HandLandmark2D[];
  CASE_2_FREE_HAND_SIDE_PROFILE: HandLandmark2D[];
  CASE_3_NOSE_TINGLING_SCRATCH: HandLandmark2D[];
} = {
  CASE_1_PHONE_IN_HAND: [
    { x: 0.34, y: 0.915 },
    { x: 0.237, y: 0.79 },
    { x: 0.176, y: 0.653 },
    { x: 0.107, y: 0.545 },
    { x: 0.069, y: 0.457 },
    { x: 0.522, y: 0.516 },
    { x: 0.63, y: 0.382 },
    { x: 0.693, y: 0.303 },
    { x: 0.721, y: 0.25 },
    { x: 0.639, y: 0.581 },
    { x: 0.793, y: 0.455 },
    { x: 0.718, y: 0.491 },
    { x: 0.609, y: 0.548 },
    { x: 0.706, y: 0.658 },
    { x: 0.838, y: 0.606 },
    { x: 0.722, y: 0.673 },
    { x: 0.576, y: 0.712 },
    { x: 0.771, y: 0.784 },
    { x: 0.874, y: 0.755 },
    { x: 0.76, y: 0.795 },
    { x: 0.654, y: 0.822 },
  ],
  CASE_2_FREE_HAND_SIDE_PROFILE: [
    { x: 0.453, y: 0.918 },
    { x: 0.408, y: 0.784 },
    { x: 0.43, y: 0.681 },
    { x: 0.437, y: 0.607 },
    { x: 0.426, y: 0.538 },
    { x: 0.585, y: 0.679 },
    { x: 0.585, y: 0.542 },
    { x: 0.563, y: 0.461 },
    { x: 0.528, y: 0.388 },
    { x: 0.629, y: 0.674 },
    { x: 0.611, y: 0.508 },
    { x: 0.563, y: 0.41 },
    { x: 0.515, y: 0.355 },
    { x: 0.632, y: 0.654 },
    { x: 0.618, y: 0.493 },
    { x: 0.57, y: 0.433 },
    { x: 0.525, y: 0.372 },
    { x: 0.646, y: 0.664 },
    { x: 0.622, y: 0.515 },
    { x: 0.575, y: 0.445 },
    { x: 0.535, y: 0.395 },
  ],
  CASE_3_NOSE_TINGLING_SCRATCH: [
    { x: 0.37, y: 0.82 },
    { x: 0.466, y: 0.737 },
    { x: 0.506, y: 0.628 },
    { x: 0.479, y: 0.518 },
    { x: 0.431, y: 0.465 },
    { x: 0.385, y: 0.458 },
    { x: 0.391, y: 0.511 },
    { x: 0.395, y: 0.535 },
    { x: 0.398, y: 0.556 },
    { x: 0.325, y: 0.499 },
    { x: 0.339, y: 0.535 },
    { x: 0.342, y: 0.558 },
    { x: 0.344, y: 0.579 },
    { x: 0.253, y: 0.569 },
    { x: 0.279, y: 0.551 },
    { x: 0.296, y: 0.585 },
    { x: 0.302, y: 0.621 },
    { x: 0.209, y: 0.611 },
    { x: 0.233, y: 0.593 },
    { x: 0.251, y: 0.622 },
    { x: 0.258, y: 0.653 },
  ],
};

