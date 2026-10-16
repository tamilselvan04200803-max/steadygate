import type { HandLandmark2D, HandParameters, RecognizedGesture } from "./types";
import {
  type AgentCodePatchEntry,
  type AgentPatchEvaluation,
  GENERATED_AGENT_PATCHES,
  computeNormalizedShape21,
  computeMirrorInvariantShapeDistance,
} from "./generated-agent-patches";

let runtimeAgentPatches: AgentCodePatchEntry[] = [...GENERATED_AGENT_PATCHES];

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
  tipToPalmCentroidMean: number;
  tipToMcpMean: number;
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
  const fourMax = Math.max(idx, mid, rng + 0, pnk);
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
  let tipToMcpSum = 0;
  for (let i = 0; i < 4; i++) {
    const m = landmarks[mcps[i]];
    const p = landmarks[pips[i]];
    const t = landmarks[tips[i]];
    if (Math.abs(p.x - m.x) > Math.abs(p.y - m.y) * 1.1) horizPipCount++;
    if (Math.abs(t.x - m.x) > Math.abs(t.y - m.y) * 1.1) horizTipCount++;
    tipToMcpSum += Math.hypot(t.x - m.x, t.y - m.y) / palmLen;
  }

  const palmCx =
    (landmarks[0].x +
      landmarks[5].x +
      landmarks[9].x +
      landmarks[13].x +
      landmarks[17].x) /
    5;
  const palmCy =
    (landmarks[0].y +
      landmarks[5].y +
      landmarks[9].y +
      landmarks[13].y +
      landmarks[17].y) /
    5;
  let tipToPalmSum = 0;
  for (const tIdx of tips) {
    tipToPalmSum +=
      Math.hypot(landmarks[tIdx].x - palmCx, landmarks[tIdx].y - palmCy) /
      palmLen;
  }

  const verticalKnuckleSpan =
    Math.abs(landmarks[17].y - landmarks[5].y) / palmLen;
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
    tipToPalmCentroidMean: Math.round((tipToPalmSum / 4) * 1000) / 1000,
    tipToMcpMean: Math.round((tipToMcpSum / 4) * 1000) / 1000,
    d4_5: hp.thumbToMcpDistances?.d4_5 ?? 0.5,
    d4_9: hp.thumbToMcpDistances?.d4_9 ?? 0.5,
    d4_17: hp.thumbToMcpDistances?.d4_17 ?? 0.8,
    thumbIndex: hp.interFingerTipDistances?.thumbIndex ?? 0.8,
    normalizedShape21: computeNormalizedShape21(landmarks),
  };
}

/**
 * Strict Bare-Fist Immunity Check:
 * Verifies that all 4 fingers are tightly curled into the palm envelope,
 * PIP joints are flexed (< 112°), MCP joints are in natural fist range (68°..128°),
 * thumb is adducted against the fist (not stretched across a phone/book spine),
 * and no foreign non-skin object mass occupies the interior palm.
 */
export function isStructuralBareFist(
  feat: FrameStructuralFeatures,
  options?: {
    foreignObjectDetected?: boolean;
    apertureOccupancyRatio?: number;
  }
): boolean {
  const hasForeignObject =
    options?.foreignObjectDetected === true ||
    (options?.apertureOccupancyRatio ?? 0) >= 0.38;
  if (hasForeignObject) return false;

  const fingersCurled =
    feat.fourMax < 0.34 &&
    feat.fourMean < 0.26 &&
    feat.meanPip4Deg < 112 &&
    feat.meanMcpDeg >= 68 &&
    feat.meanMcpDeg <= 128;

  const tipsInsidePalm = feat.tipToPalmCentroidMean < 0.46;

  const thumbCompact =
    feat.thumbFlex < 0.56 &&
    feat.d4_5 < 0.58 &&
    feat.d4_9 < 0.48 &&
    feat.d4_17 < 1.04;

  return fingersCurled && tipsInsidePalm && thumbCompact;
}

/**
 * Sanitizes any candidate or persisted AgentCodePatchEntry so that a negative
 * BLOCK_OBJECT_HOLD rule can NEVER match a bare canonical FIST or OPEN_PALM on
 * 21-landmark shape distance alone.
 */
export function sanitizeAgentPatchAgainstBareFist(
  patch: AgentCodePatchEntry
): AgentCodePatchEntry {
  if (patch.action !== "BLOCK_OBJECT_HOLD") return patch;

  const updated: AgentCodePatchEntry = {
    ...patch,
    predicates: { ...(patch.predicates || {}) },
  };

  // Tighten shape tolerance if present so it never collides broadly with bare fists
  if (updated.shapeTolerance !== undefined && updated.shapeTolerance > 0.12) {
    updated.shapeTolerance = 0.12;
  }

  // Ensure every BLOCK_OBJECT_HOLD rule has at least one physical/joint dissociation guard
  const pred = updated.predicates;
  const hasSurfaceClampGuard =
    (pred.minMeanPip4Deg ?? 0) >= 120 && (pred.maxMeanMcpDeg ?? 180) <= 132;
  const hasSpineHookGuard =
    pred.requireVerticalKnuckleStack === true &&
    (pred.minMeanMcpDeg ?? 0) >= 134 &&
    (pred.minD4_17 ?? 0) >= 1.05;
  const hasWideClampGuard =
    (pred.minD4_9 ?? 0) >= 0.49 && (pred.minFourMean ?? 0) >= 0.22;

  if (!hasSurfaceClampGuard && !hasSpineHookGuard && !hasWideClampGuard) {
    if (pred.requireVerticalKnuckleStack && (pred.minHorizPipCount ?? 0) >= 3) {
      pred.minMeanMcpDeg = Math.max(pred.minMeanMcpDeg ?? 0, 134);
      pred.minD4_9 = Math.max(pred.minD4_9 ?? 0, 0.49);
      pred.minD4_17 = Math.max(pred.minD4_17 ?? 0, 1.06);
    } else {
      pred.minFourMean = Math.max(pred.minFourMean ?? 0, 0.22);
      pred.minD4_9 = Math.max(pred.minD4_9 ?? 0, 0.50);
    }
  }

  return updated;
}

export function setRuntimeAgentPatches(patches: AgentCodePatchEntry[]): void {
  const map = new Map<string, AgentCodePatchEntry>();
  for (const p of GENERATED_AGENT_PATCHES) {
    map.set(p.id, sanitizeAgentPatchAgainstBareFist(p));
  }
  for (const p of patches) {
    map.set(p.id, sanitizeAgentPatchAgainstBareFist(p));
  }
  runtimeAgentPatches = Array.from(map.values());
}

export function addRuntimeAgentPatch(patch: AgentCodePatchEntry): void {
  const clean = sanitizeAgentPatchAgainstBareFist(patch);
  runtimeAgentPatches = [
    clean,
    ...runtimeAgentPatches.filter((p) => p.id !== clean.id),
  ];
}

export function getRuntimeAgentPatches(): AgentCodePatchEntry[] {
  return runtimeAgentPatches;
}

/**
 * Evaluates all built-in + AI-Agent-synthesized structural rules and 21-landmark templates.
 * Enforces Phase 1 Bare-Fist Immunity and bans pure-skeletal object blocks without
 * joint-angle dissociation or photometric foreign-object confirmation.
 */
export function evaluateAgentPatches(
  landmarks: HandLandmark2D[],
  hp: HandParameters,
  options?: {
    foreignObjectDetected?: boolean;
    apertureOccupancyRatio?: number;
  }
): AgentPatchEvaluation | null {
  if (!landmarks || landmarks.length < 21) return null;
  const feat = extractFrameStructuralFeatures(landmarks, hp);
  const bareFistImmune = isStructuralBareFist(feat, options);
  const hasPhotometricObject =
    options?.foreignObjectDetected === true ||
    (options?.apertureOccupancyRatio ?? 0) >= 0.38;

  // Physical / biomechanical dissociation required for any object-hold block
  const hasJointDissociationOrWideSpan =
    (feat.meanPip4Deg >= 120 && feat.meanMcpDeg <= 132) ||
    (feat.verticalKnuckleStack &&
      feat.meanMcpDeg >= 134 &&
      feat.d4_17 >= 1.06 &&
      feat.d4_9 >= 0.49) ||
    (feat.d4_9 >= 0.50 && feat.fourMean >= 0.22) ||
    hasPhotometricObject;

  for (const patch of runtimeAgentPatches) {
    if (patch.action === "BLOCK_OBJECT_HOLD") {
      // Phase 1 Hard Rule: Never block a canonical bare fist or open palm
      if (bareFistImmune || feat.fourMean >= 0.72) {
        continue;
      }
      // Phase 1 Hard Rule: Ban pure-skeletal blocks that lack joint-angle dissociation or photometric object mass
      if (!hasJointDissociationOrWideSpan) {
        continue;
      }
    }

    const pred = patch.predicates;
    let predicatesPass = true;
    if (pred && Object.keys(pred).length > 0) {
      if (
        pred.requireVerticalKnuckleStack !== undefined &&
        feat.verticalKnuckleStack !== pred.requireVerticalKnuckleStack
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minHorizPipCount !== undefined &&
        feat.horizPipCount < pred.minHorizPipCount
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minHorizTipCount !== undefined &&
        feat.horizTipCount < pred.minHorizTipCount
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minMeanMcpDeg !== undefined &&
        feat.meanMcpDeg < pred.minMeanMcpDeg
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxMeanMcpDeg !== undefined &&
        feat.meanMcpDeg > pred.maxMeanMcpDeg
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minMeanPip4Deg !== undefined &&
        feat.meanPip4Deg < pred.minMeanPip4Deg
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxMeanPip4Deg !== undefined &&
        feat.meanPip4Deg > pred.maxMeanPip4Deg
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minFourMean !== undefined &&
        feat.fourMean < pred.minFourMean
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxFourMean !== undefined &&
        feat.fourMean > pred.maxFourMean
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxFourMax !== undefined &&
        feat.fourMax > pred.maxFourMax
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minThumbFlex !== undefined &&
        feat.thumbFlex < pred.minThumbFlex
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxThumbFlex !== undefined &&
        feat.thumbFlex > pred.maxThumbFlex
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minD4_5 !== undefined &&
        feat.d4_5 < pred.minD4_5
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxD4_5 !== undefined &&
        feat.d4_5 > pred.maxD4_5
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minD4_9 !== undefined &&
        feat.d4_9 < pred.minD4_9
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxD4_9 !== undefined &&
        feat.d4_9 > pred.maxD4_9
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.minD4_17 !== undefined &&
        feat.d4_17 < pred.minD4_17
      ) {
        predicatesPass = false;
      }
      if (
        predicatesPass &&
        pred.maxThumbIndex !== undefined &&
        feat.thumbIndex > pred.maxThumbIndex
      ) {
        predicatesPass = false;
      }
    }

    if (!predicatesPass) {
      continue;
    }

    // If patch also specifies a 21-landmark template, verify shape proximity
    if (patch.normalizedShape21 && patch.normalizedShape21.length === 21) {
      const dist = computeMirrorInvariantShapeDistance(
        feat.normalizedShape21,
        patch.normalizedShape21
      );
      const tol = patch.shapeTolerance ?? 0.12;
      if (dist > tol) {
        continue;
      }
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
  const feat = extractFrameStructuralFeatures(
    params.landmarks,
    params.handParams
  );
  const id = `agent_patch_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;

  let rootCauseDiagnosis = "";
  const predicates: AgentCodePatchEntry["predicates"] = {};

  if (params.action === "BLOCK_OBJECT_HOLD") {
    if (
      feat.verticalKnuckleStack &&
      (feat.horizPipCount >= 3 || feat.horizTipCount >= 3)
    ) {
      rootCauseDiagnosis = `Detected vertical knuckle stack (span=${feat.verticalKnuckleSpan}) with ${Math.max(
        feat.horizPipCount,
        feat.horizTipCount
      )}/4 horizontal fingers (meanMCP=${feat.meanMcpDeg}°, meanPIP=${feat.meanPip4Deg}°). Side-edge object/book grip compressed wrist-to-tip distances (${feat.fourMean}) and occluded the thumb C-aperture (thumbIndex=${feat.thumbIndex}). Synthesized mirror-invariant 21-landmark template + side-edge clamp predicate with Bare-Fist Immunity.`;
      predicates.requireVerticalKnuckleStack = true;
      if (feat.horizPipCount >= 3) predicates.minHorizPipCount = 3;
      if (feat.horizTipCount >= 3) predicates.minHorizTipCount = 3;
      if (feat.meanPip4Deg >= 120) {
        predicates.maxMeanMcpDeg = Math.min(130, Math.round(feat.meanMcpDeg + 18));
        predicates.minMeanPip4Deg = Math.max(120, Math.round(feat.meanPip4Deg - 16));
      } else {
        predicates.minMeanMcpDeg = Math.max(134, Math.round(feat.meanMcpDeg - 12));
        predicates.minD4_9 = Math.max(0.49, Math.round((feat.d4_9 - 0.05) * 100) / 100);
        predicates.minD4_17 = Math.max(1.06, Math.round((feat.d4_17 - 0.08) * 100) / 100);
      }
      predicates.maxThumbIndex = Math.round((feat.thumbIndex + 0.16) * 100) / 100;
    } else {
      rootCauseDiagnosis = `Detected object-holding posture (fourMean=${feat.fourMean}, meanMCP=${feat.meanMcpDeg}°, meanPIP=${feat.meanPip4Deg}°, d4_9=${feat.d4_9}). Synthesized mirror-invariant 21-landmark Procrustes template (tol=0.12) and bounded joint-angle dissociation guard with Bare-Fist Immunity.`;
      predicates.minFourMean = Math.max(
        0.22,
        Math.round((feat.fourMean - 0.10) * 100) / 100
      );
      predicates.maxFourMean = Math.min(
        0.66,
        Math.round((feat.fourMean + 0.12) * 100) / 100
      );
      predicates.maxMeanMcpDeg = Math.round(feat.meanMcpDeg + 20);
      predicates.minMeanPip4Deg = Math.max(
        118,
        Math.round(feat.meanPip4Deg - 18)
      );
      predicates.minD4_9 = Math.max(
        0.50,
        Math.round((feat.d4_9 - 0.12) * 100) / 100
      );
    }
  } else {
    rootCauseDiagnosis = `Learned positive gesture override -> ${
      params.targetGesture || "OPEN_PALM"
    } (fourMean=${feat.fourMean}, meanPIP=${feat.meanPip4Deg}°, d4_9=${feat.d4_9}). Synthesized mirror-invariant 21-landmark shape template.`;
    predicates.minFourMean = Math.max(
      0,
      Math.round((feat.fourMean - 0.15) * 100) / 100
    );
    predicates.maxFourMean = Math.min(
      1,
      Math.round((feat.fourMean + 0.15) * 100) / 100
    );
  }

  const rawPatch: AgentCodePatchEntry = {
    id,
    createdAt: new Date().toISOString(),
    description:
      params.userNotes && params.userNotes.trim().length > 0
        ? `${params.userNotes.trim()} [Auto-Diagnosed: ${rootCauseDiagnosis}]`
        : rootCauseDiagnosis,
    action: params.action,
    targetGesture: params.targetGesture,
    normalizedShape21: feat.normalizedShape21,
    shapeTolerance: 0.12,
    predicates,
  };

  const patch = sanitizeAgentPatchAgainstBareFist(rawPatch);
  return { patch, rootCauseDiagnosis };
}
