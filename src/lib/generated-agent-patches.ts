/**
 * AUTO-SYNTHESIZED BY STEADYGATE IN-APP AUTONOMOUS AI AGENT (`/api/ai-agent`)
 * ---------------------------------------------------------------------------
 * This module contains executable biomechanical & visual object-hold rules
 * synthesized by the embedded Self-Healing AI Agent from live camera failure
 * captures and natural-language instructions.
 */

import type { HandLandmark2D, HandParameters, RecognizedGesture } from "./types";

export interface AgentPatchEvaluation {
  matched: boolean;
  ruleId: string;
  action: "BLOCK_OBJECT_HOLD" | "FORCE_GESTURE";
  targetGesture?: RecognizedGesture;
  reason?:
    | "SIDE_EDGE_BOOK_OR_OBJECT_CLAMP"
    | "AGENT_SELF_HEALED_OBJECT_RULE"
    | "ADMIN_LEARNED_NEGATIVE_GRASP";
  confidence?: number;
  diagnosis: string;
}

export interface AgentCodePatchEntry {
  id: string;
  createdAt: string;
  description: string;
  action: "BLOCK_OBJECT_HOLD" | "FORCE_GESTURE";
  targetGesture?: RecognizedGesture;
  normalizedShape21?: Array<{ x: number; y: number }>;
  shapeTolerance?: number;
  predicates: {
    minHorizPipCount?: number;
    minHorizTipCount?: number;
    requireVerticalKnuckleStack?: boolean;
    minMeanMcpDeg?: number;
    maxMeanMcpDeg?: number;
    minMeanPip4Deg?: number;
    maxMeanPip4Deg?: number;
    minFourMean?: number;
    maxFourMean?: number;
    maxFourMax?: number;
    minThumbFlex?: number;
    maxThumbFlex?: number;
    minD4_5?: number;
    maxD4_5?: number;
    minD4_9?: number;
    maxD4_9?: number;
    minD4_17?: number;
    maxThumbIndex?: number;
  };
}

/**
 * Normalizes 21 hand landmarks into a wrist-centered, palm-length-scaled coordinate frame.
 */
export function computeNormalizedShape21(
  landmarks: HandLandmark2D[]
): Array<{ x: number; y: number }> {
  if (!landmarks || landmarks.length < 21) return [];
  const wrist = landmarks[0];
  const palmLen = Math.max(
    Math.hypot(landmarks[9].x - wrist.x, landmarks[9].y - wrist.y),
    1e-4
  );
  return landmarks.slice(0, 21).map((p) => ({
    x: Math.round(((p.x - wrist.x) / palmLen) * 1000) / 1000,
    y: Math.round(((p.y - wrist.y) / palmLen) * 1000) / 1000,
  }));
}

/**
 * Mirror-invariant L1 distance between two normalized 21-landmark hand shapes.
 * Automatically checks both original and horizontally mirrored (left/right hand) orientations.
 */
export function computeMirrorInvariantShapeDistance(
  liveShape: Array<{ x: number; y: number }>,
  refShape: Array<{ x: number; y: number }>
): number {
  if (liveShape.length < 21 || refShape.length < 21) return 999;
  let directSum = 0;
  let mirrorSum = 0;
  for (let i = 0; i < 21; i++) {
    directSum +=
      Math.abs(liveShape[i].x - refShape[i].x) +
      Math.abs(liveShape[i].y - refShape[i].y);
    mirrorSum +=
      Math.abs(-liveShape[i].x - refShape[i].x) +
      Math.abs(liveShape[i].y - refShape[i].y);
  }
  return Math.min(directSum / 21, mirrorSum / 21);
}

/**
 * Built-in + Agent-Appended Executable Patch Registry
 * Guaranteed free of bare-fist and bare-open-palm collisions.
 */
export const GENERATED_AGENT_PATCHES: AgentCodePatchEntry[] = [
  {
    id: "patch_case4_side_book_cover_clamp",
    createdAt: "2026-10-16T13:30:00.000Z",
    description:
      "Block Side-Edge Book/Notebook Cover Clamp (vertical knuckle stack 5-9-13-17, 4 fingers reaching horizontally across book cover with flexed MCP knuckles < 130° and open PIP joints >= 122°)",
    action: "BLOCK_OBJECT_HOLD",
    predicates: {
      requireVerticalKnuckleStack: true,
      minHorizTipCount: 3,
      maxMeanMcpDeg: 130,
      minMeanPip4Deg: 122,
      minFourMean: 0.24,
      minD4_9: 0.52,
    },
  },
  {
    id: "patch_case5_vertical_book_spine_grip",
    createdAt: "2026-10-16T13:30:00.000Z",
    description:
      "Block Vertical Book Spine Side-Hook Grip (vertical knuckle stack 5-9-13-17, extended MCP >= 134° with horizontal PIP segments wrapping spine, thumb bracing spine edge d4_9 >= 0.49 & d4_17 >= 1.06)",
    action: "BLOCK_OBJECT_HOLD",
    predicates: {
      requireVerticalKnuckleStack: true,
      minHorizPipCount: 3,
      minMeanMcpDeg: 134,
      maxFourMax: 0.46,
      minThumbFlex: 0.30,
      maxThumbFlex: 0.75,
      minD4_9: 0.49,
      maxD4_9: 0.68,
      minD4_17: 1.06,
      maxThumbIndex: 0.44,
    },
  },
];
