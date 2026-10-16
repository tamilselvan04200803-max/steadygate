import type { HandLandmark2D, HandParameters, RecognizedGesture } from "./types";
import {
  type AgentCodePatchEntry,
  type AgentPatchEvaluation,
  GENERATED_AGENT_PATCHES,
  computeNormalizedShape21,
  computeMirrorInvariantShapeDistance,
} from "./generated-agent-patches";

let runtimeAgentPatches: AgentCodePatchEntry[] = [...GENERATED_AGENT_PATCHES];

export function setRuntimeAgentPatches(patches: AgentCodePatchEntry[]): void {
  const map = new Map<string, AgentCodePatchEntry>();
  for (const p of GENERATED_AGENT_PATCHES) {
    map.set(p.id, p);
  }
  for (const p of patches) {
    map.set(p.id, p);
  }
  runtimeAgentPatches = Array.from(map.values());
}

export function addRuntimeAgentPatch(patch: AgentCodePatchEntry): void {
  runtimeAgentPatches = [
    patch,
    ...runtimeAgentPatches.filter((p) => p.id !== patch.id),
  ];
}

export function getRuntimeAgentPatches(): AgentCodePatchEntry[] {
  return runtimeAgentPatches;
}

export interface FrameStructuralFeatures {
  horizPipCount: number;
  horizTipCount: number;
  verticalKnuckleStack: boolean;
  verticalKnuckleSpan: number;
  meanMcpDeg: number;
  meanPip4Deg: number;
  fourMean: number;
  fourMax: number;
  fourMin: number;
  thumbFlex: number;
  d4_5: number;
  d4_9: number;
  d4_17: number;
  thumbIndex: number;
  normalizedShape21: Array<{ x: number; y: number }>;
}

export function extractFrameStructuralFeatures(
  landmarks: HandLandmark2D[],
  hp: HandParameters
): FrameStructuralFeatures {
  const wrist = landmarks[0];
  const palmLen = Math.max(
    Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y),
    1e-4
  );
  const [thumb, idx, mid, rng, pnk] = hp.fingerFlexion;
  const fourMean = (idx + mid + rng + pnk) / 4;
  const fourMax = Math.max(idx, mid, rng, pnk);
  const fourMin = Math.min(idx, mid, rng, pnk);

  const pip = hp.pipJointAnglesDeg || [160, 160, 160, 160, 160];
  const mcp = hp.mcpJointAnglesDeg || [160, 160, 160, 160];
  const meanMcpDeg = (mcp[0] + mcp[1] + mcp[2] + mcp[3]) / 4;
  const meanPip4Deg = (pip[1] + pip[2] + pip[3] + pip[4]) / 4;

  const mcps = [5, 9, 13, 17];
  const pips = [6, 10, 14, 18];
  const tips = [8, 12, 16, 20];
  let horizPipCount = 0;
  let horizTipCount = 0;
  for (let i = 0; i < 4; i++) {
    const m = landmarks[mcps[i]];
    const p = landmarks[pips[i]];
    const t = landmarks[tips[i]];
    if (Math.abs(p.x - m.x) > Math.abs(p.y - m.y) * 1.1) horizPipCount++;
    if (Math.abs(t.x - m.x) > Math.abs(t.y - m.y) * 1.1) horizTipCount++;
  }

  const verticalKnuckleSpan = Math.abs(landmarks[17].y - landmarks[5].y) / palmLen;
  const verticalKnuckleStack =
    landmarks[5].y < landmarks[9].y &&
    landmarks[9].y < landmarks[13].y &&
    landmarks[13].y < landmarks[17].y &&
    verticalKnuckleSpan >= 0.36 &&
    Math.abs(landmarks[17].y - landmarks[5].y) >
      Math.abs(landmarks[17].x - landmarks[5].x) * 1.35;

  return {
    horizPipCount,
    horizTipCount,
    verticalKnuckleStack,
    verticalKnuckleSpan: Math.round(verticalKnuckleSpan * 1000) / 1000,
    meanMcpDeg: Math.round(meanMcpDeg * 10) / 10,
    meanPip4Deg: Math.round(meanPip4Deg * 10) / 10,
    fourMean: Math.round(fourMean * 1000) / 1000,
    fourMax: Math.round(fourMax * 1000) / 1000,
    fourMin: Math.round(fourMin * 1000) / 1000,
    thumbFlex: Math.round(thumb * 1000) / 1000,
    d4_5: hp.thumbToMcpDistances?.d4_5 ?? 0.5,
    d4_9: hp.thumbToMcpDistances?.d4_9 ?? 0.5,
    d4_17: hp.thumbToMcpDistances?.d4_17 ?? 0.8,
    thumbIndex: hp.interFingerTipDistances?.thumbIndex ?? 0.8,
    normalizedShape21: computeNormalizedShape21(landmarks),
  };
}

/**
 * Evaluates all built-in + AI-Agent-synthesized structural rules and 21-landmark templates.
 */
export function evaluateAgentPatches(
  landmarks: HandLandmark2D[],
  hp: HandParameters
): AgentPatchEvaluation | null {
  if (!landmarks || landmarks.length < 21) return null;
  const feat = extractFrameStructuralFeatures(landmarks, hp);

  for (const patch of runtimeAgentPatches) {
    // 1. Check 21-landmark mirror-invariant template match if present
    if (patch.normalizedShape21 && patch.normalizedShape21.length === 21) {
      const dist = computeMirrorInvariantShapeDistance(
        feat.normalizedShape21,
        patch.normalizedShape21
      );
      const tol = patch.shapeTolerance ?? 0.14;
      if (dist <= tol) {
        return {
          matched: true,
          ruleId: patch.id,
          action: patch.action,
          targetGesture: patch.targetGesture,
          reason:
            patch.action === "BLOCK_OBJECT_HOLD"
              ? "AGENT_SELF_HEALED_OBJECT_RULE"
              : undefined,
          confidence: Math.min(0.99, Math.round((0.92 + (1 - dist / tol) * 0.07) * 100) / 100),
          diagnosis: patch.description,
        };
      }
    }

    // 2. Check synthesized biomechanical predicates if present
    const pred = patch.predicates;
    if (!pred || Object.keys(pred).length === 0) continue;

    if (
      pred.requireVerticalKnuckleStack !== undefined &&
      feat.verticalKnuckleStack !== pred.requireVerticalKnuckleStack
    ) {
      continue;
    }
    if (pred.minHorizPipCount !== undefined && feat.horizPipCount < pred.minHorizPipCount) {
      continue;
    }
    if (pred.minHorizTipCount !== undefined && feat.horizTipCount < pred.minHorizTipCount) {
      continue;
    }
    if (pred.maxMeanMcpDeg !== undefined && feat.meanMcpDeg > pred.maxMeanMcpDeg) {
      continue;
    }
    if (pred.minMeanPip4Deg !== undefined && feat.meanPip4Deg < pred.minMeanPip4Deg) {
      continue;
    }
    if (pred.maxMeanPip4Deg !== undefined && feat.meanPip4Deg > pred.maxMeanPip4Deg) {
      continue;
    }
    if (pred.minFourMean !== undefined && feat.fourMean < pred.minFourMean) {
      continue;
    }
    if (pred.maxFourMean !== undefined && feat.fourMean > pred.maxFourMean) {
      continue;
    }
    if (pred.maxFourMax !== undefined && feat.fourMax > pred.maxFourMax) {
      continue;
    }
    if (pred.minThumbFlex !== undefined && feat.thumbFlex < pred.minThumbFlex) {
      continue;
    }
    if (pred.maxThumbFlex !== undefined && feat.thumbFlex > pred.maxThumbFlex) {
      continue;
    }
    if (pred.minD4_9 !== undefined && feat.d4_9 < pred.minD4_9) {
      continue;
    }
    if (pred.maxD4_9 !== undefined && feat.d4_9 > pred.maxD4_9) {
      continue;
    }
    if (pred.minD4_17 !== undefined && feat.d4_17 < pred.minD4_17) {
      continue;
    }
    if (pred.maxThumbIndex !== undefined && feat.thumbIndex > pred.maxThumbIndex) {
      continue;
    }

    return {
      matched: true,
      ruleId: patch.id,
      action: patch.action,
      targetGesture: patch.targetGesture,
      reason:
        patch.id.includes("case4") || patch.id.includes("case5")
          ? "SIDE_EDGE_BOOK_OR_OBJECT_CLAMP"
          : "AGENT_SELF_HEALED_OBJECT_RULE",
      confidence: 0.96,
      diagnosis: patch.description,
    };
  }

  return null;
}

/**
 * Synthesizes a generalized AgentCodePatchEntry from a live failure frame + user intent.
 */
export function synthesizeAgentPatchFromFrame(params: {
  landmarks: HandLandmark2D[];
  handParams: HandParameters;
  action: "BLOCK_OBJECT_HOLD" | "FORCE_GESTURE";
  targetGesture?: RecognizedGesture;
  userNotes?: string;
}): {
  patch: AgentCodePatchEntry;
  rootCauseDiagnosis: string;
} {
  const feat = extractFrameStructuralFeatures(params.landmarks, params.handParams);
  const id = `agent_patch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  let rootCauseDiagnosis = "";
  const predicates: AgentCodePatchEntry["predicates"] = {};

  if (params.action === "BLOCK_OBJECT_HOLD") {
    if (feat.verticalKnuckleStack && (feat.horizPipCount >= 3 || feat.horizTipCount >= 3)) {
      rootCauseDiagnosis = `Detected vertical knuckle stack (span=${feat.verticalKnuckleSpan}) with ${Math.max(
        feat.horizPipCount,
        feat.horizTipCount
      )}/4 horizontal fingers (meanMCP=${feat.meanMcpDeg}°, meanPIP=${feat.meanPip4Deg}°). Side-edge object/book grip compressed wrist-to-tip distances (${feat.fourMean}) and occluded the thumb C-aperture (thumbIndex=${feat.thumbIndex}). Synthesized mirror-invariant 21-landmark template + side-edge clamp predicate.`;
      predicates.requireVerticalKnuckleStack = true;
      if (feat.horizPipCount >= 3) predicates.minHorizPipCount = 3;
      if (feat.horizTipCount >= 3) predicates.minHorizTipCount = 3;
      predicates.maxMeanMcpDeg = Math.round(feat.meanMcpDeg + 18);
      predicates.minMeanPip4Deg = Math.max(0, Math.round(feat.meanPip4Deg - 18));
      predicates.maxMeanPip4Deg = Math.min(180, Math.round(feat.meanPip4Deg + 20));
      predicates.maxThumbIndex = Math.round((feat.thumbIndex + 0.16) * 100) / 100;
    } else {
      rootCauseDiagnosis = `Detected object-holding posture (fourMean=${feat.fourMean}, meanMCP=${feat.meanMcpDeg}°, meanPIP=${feat.meanPip4Deg}°, d4_9=${feat.d4_9}). Synthesized mirror-invariant 21-landmark Procrustes template (tol=0.14) and bounded joint-angle guard to block false gesture triggers on both left and right hands.`;
      predicates.minFourMean = Math.max(0, Math.round((feat.fourMean - 0.12) * 100) / 100);
      predicates.maxFourMean = Math.min(0.68, Math.round((feat.fourMean + 0.12) * 100) / 100);
      predicates.maxMeanMcpDeg = Math.round(feat.meanMcpDeg + 16);
      predicates.minMeanPip4Deg = Math.max(0, Math.round(feat.meanPip4Deg - 16));
      predicates.maxMeanPip4Deg = Math.min(180, Math.round(feat.meanPip4Deg + 16));
    }
  } else {
    rootCauseDiagnosis = `Synthesized positive posture adaptation for [${params.targetGesture}] (fourMean=${feat.fourMean}, thumb=${feat.thumbFlex}, meanPIP=${feat.meanPip4Deg}°, d4_9=${feat.d4_9}). Added mirror-invariant 21-landmark template and pruned conflicting negative grasp rules.`;
  }

  const patch: AgentCodePatchEntry = {
    id,
    createdAt: new Date().toISOString(),
    description:
      params.userNotes ||
      (params.action === "BLOCK_OBJECT_HOLD"
        ? `AI Agent Auto-Synthesized Object-Hold Block (${rootCauseDiagnosis.slice(0, 90)}...)`
        : `AI Agent Auto-Synthesized Gesture Rule for ${params.targetGesture}`),
    action: params.action,
    targetGesture: params.targetGesture,
    normalizedShape21: feat.normalizedShape21,
    shapeTolerance: 0.14,
    predicates: params.action === "BLOCK_OBJECT_HOLD" ? predicates : {},
  };

  return { patch, rootCauseDiagnosis };
}
