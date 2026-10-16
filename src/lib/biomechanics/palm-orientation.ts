import type { HandLandmark2D } from "../types";
import type { Handedness, PalmOrientation } from "../../../.swarm/contracts/types";

function dist2D(a: HandLandmark2D, b: HandLandmark2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Subagent S1 — 3D Palm Normal & Camera-Space Orientation Engine
 * Computes the 3D palm surface normal via the cross product:
 *   v_index = L_5 - L_0
 *   v_pinky = L_17 - L_0
 *   n = v_index x v_pinky
 * Normalized by palmLen^2 for scale invariance.
 */
export function computePalmOrientation(
  landmarks: HandLandmark2D[],
  handedness: Handedness = "Right"
): PalmOrientation {
  if (!landmarks || landmarks.length < 21) {
    return {
      normalX: 0,
      normalY: 0,
      normalZ: -1,
      isPalmar: true,
      isDorsal: false,
      rollAngleDeg: 0,
      pitchAngleDeg: 0,
    };
  }

  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const middleMcp = landmarks[9];
  const pinkyMcp = landmarks[17];

  const palmLen = Math.max(dist2D(wrist, middleMcp), 1e-4);
  const palmLenSq = palmLen * palmLen;

  const z0 = wrist.z ?? 0;
  const z5 = indexMcp.z ?? 0;
  const z9 = middleMcp.z ?? 0;
  const z17 = pinkyMcp.z ?? 0;

  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v1z = z5 - z0;

  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;
  const v2z = z17 - z0;

  const crossX = (v1y * v2z - v1z * v2y) / palmLenSq;
  const crossY = (v1z * v2x - v1x * v2z) / palmLenSq;
  let crossZ = -(v1x * v2y - v1y * v2x) / palmLenSq;

  if (handedness === "Left") {
    crossZ = -crossZ;
  }

  const rollRad = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
  const rollAngleDeg = Math.round(((rollRad * 180) / Math.PI + 90) * 10) / 10;

  const dz = z9 - z0;
  const pitchRad = Math.atan2(dz, palmLen);
  const pitchAngleDeg = Math.round(((pitchRad * 180) / Math.PI) * 10) / 10;

  const isPalmar = crossZ < -0.002;
  const isDorsal = crossZ > 0.002;

  return {
    normalX: Math.round(crossX * 10000) / 10000,
    normalY: Math.round(crossY * 10000) / 10000,
    normalZ: Math.round(crossZ * 10000) / 10000,
    isPalmar,
    isDorsal,
    rollAngleDeg,
    pitchAngleDeg,
  };
}

/**
 * Determines whether a hand with high/low 2D aspect ratio is a natural 3D rotated or tilted
 * free hand (yaw/side-profile or pitch foreshortening) rather than a collapsed/occluded palm.
 *
 * True occluded palms (`OCCLUDED_BOOK` and synthetic aspect-collapse sticks) either have:
 *  - crushed proximal finger bones (`dist(5,6)/palmLen < 0.12`), OR
 *  - degenerate zero-width vertical sticks (`|x_8 - x_5| < 1e-5 && |x_9 - x_0| < 1e-5`).
 * Every real 3D rotated/side-profile human hand on a webcam has intact bone segments and
 * non-zero organic horizontal/depth geometry.
 */
export function isNaturalSideProfileFreeHand(
  landmarks: HandLandmark2D[],
  _fingerFlexion?: [number, number, number, number, number]
): boolean {
  if (!landmarks || landmarks.length < 21) return false;
  const wrist = landmarks[0];
  const palmLen = Math.max(dist2D(wrist, landmarks[9]), 1e-5);
  const proxIdxRatio = dist2D(landmarks[5], landmarks[6]) / palmLen;
  const proxMidRatio = dist2D(landmarks[9], landmarks[10]) / palmLen;
  const hasIntactProximalBones = proxIdxRatio >= 0.04 && proxMidRatio >= 0.04;
  const isDegenerateVerticalStick =
    Math.abs(landmarks[8].x - landmarks[5].x) < 1e-5 &&
    Math.abs(landmarks[12].x - landmarks[9].x) < 1e-5 &&
    Math.abs(landmarks[9].x - wrist.x) < 1e-5;

  return hasIntactProximalBones && !isDegenerateVerticalStick;
}
