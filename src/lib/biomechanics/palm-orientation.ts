import type { HandLandmark2D } from "../types";
import type { Handedness, PalmOrientation } from "../../../.swarm/contracts/types";

/**
 * Subagent S1 — 3D Palmar/Dorsal Normal & Side-Profile Specialist
 * Computes the 3D surface normal of the palm triangle (wrist 0, index MCP 5, pinky MCP 17)
 * and provides the 3D radial/ulnar side-profile free-hand invariant (Failure Case 2).
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

  const v1x = indexMcp.x - wrist.x;
  const v1y = indexMcp.y - wrist.y;
  const v1z = (indexMcp.z ?? 0) - (wrist.z ?? 0);

  const v2x = pinkyMcp.x - wrist.x;
  const v2y = pinkyMcp.y - wrist.y;
  const v2z = (pinkyMcp.z ?? 0) - (wrist.z ?? 0);

  // Cross product oriented so that a palmar Right hand facing the camera yields normalZ < -0.002,
  // and handedness === "Left" inverts the chiral sign.
  const chiralSign = handedness === "Left" ? 1 : -1;
  const rawNx = (v1y * v2z - v1z * v2y) * chiralSign;
  const rawNy = (v1z * v2x - v1x * v2z) * chiralSign;
  const rawNz = (v1x * v2y - v1y * v2x) * chiralSign;

  const mag = Math.hypot(rawNx, rawNy, rawNz) || 1e-6;
  const normalX = Math.round((rawNx / mag) * 1000) / 1000;
  const normalY = Math.round((rawNy / mag) * 1000) / 1000;
  const normalZ = Math.round(rawNz * 10000) / 10000;

  const isPalmar = normalZ < -0.002;
  const isDorsal = normalZ > 0.002;

  const rollAngleDeg =
    Math.round(((Math.atan2(pinkyMcp.y - indexMcp.y, pinkyMcp.x - indexMcp.x) * 180) / Math.PI) * 10) /
    10;
  const pitchAngleDeg =
    Math.round(((Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x) * 180) / Math.PI + 90) * 10) /
    10;

  return {
    normalX,
    normalY,
    normalZ,
    isPalmar,
    isDorsal,
    rollAngleDeg,
    pitchAngleDeg,
  };
}

/**
 * Exempts natural 3D radial/ulnar side-profile free hands (Failure Case 2: Screenshot 114648)
 * where all 4 fingers are cleanly extended upward (fourMin >= 0.70, palmLen >= 0.22)
 * and the dorsal knuckle ridge is naturally offset from the wrist (|x9 - x0|/palmLen >= 0.28).
 */
export function isNaturalSideProfileFreeHand(
  aspect: number,
  palmLen: number,
  fourMin: number,
  wristX: number,
  middleMcpX: number
): boolean {
  const safePalmLen = Math.max(palmLen, 1e-5);
  return (
    aspect > 3.6 &&
    aspect <= 6.2 &&
    palmLen >= 0.22 &&
    fourMin >= 0.70 &&
    Math.abs(middleMcpX - wristX) / safePalmLen >= 0.28
  );
}
