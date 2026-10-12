import {
  RiskTier,
  BaselineMode,
  RejectCode,
  IntentComponents,
  UserProfile,
  Appliance,
} from "./types";

export interface GateInput {
  posterior: number; // Top-1 confidence [0, 1]
  top2Posterior?: number; // Top-2 confidence [0, 1]
  margin?: number; // Margin between top-1 and top-2
  attention: number; // Head pose / gaze attention [0, 1]
  stabilityRaw: number; // Raw stillness [0, 1]
  stabilityNorm: number; // Tremor-normalized stillness [0, 1]
  sceneQuality: number; // Lighting / contrast [0, 1]
  contextPrior: number; // Prior from appliance state/time [0, 1]
  dwellTimeHeldMs: number;
  user: UserProfile;
  appliance: Appliance;
  baselineMode?: BaselineMode;
  isSecondaryHandshakeGesture?: boolean;
}

export interface GateDecision {
  status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING";
  rejectCode: RejectCode;
  rejectExplanation: string;
  intentScore: number;
  intentComponents: IntentComponents;
  dwellRequiredMs: number;
  dwellCompletedMs: number;
  dwellProgressPct: number;
  isAchieved: boolean;
  requiresSecondaryConfirmation: boolean;
  isHandshakeReady: boolean;
}

/**
 * F3: Fused Intent Calculation
 * Combines posterior, margin, attention, signature-normalized stability, scene quality, and context prior.
 */
export function calculateIntentScore(
  components: {
    posterior: number;
    margin: number;
    attention: number;
    stabilityNorm: number;
    sceneQuality: number;
    contextPrior: number;
  }
): number {
  const { posterior, margin, attention, stabilityNorm, sceneQuality, contextPrior } = components;

  // Margin factor: soft saturation for confidence separation
  const marginFactor = Math.min(1.0, 0.4 + margin * 1.5);

  // Intent score I in [0, 1]
  const rawScore =
    Math.pow(posterior, 0.8) *
    marginFactor *
    Math.pow(attention, 0.9) *
    Math.pow(stabilityNorm, 0.9) *
    Math.pow(sceneQuality, 0.4) *
    Math.pow(contextPrior, 0.3);

  return Math.max(0, Math.min(1, Math.round(rawScore * 1000) / 1000));
}

/**
 * F4: Risk-Tiered Uncertainty-Adaptive Dwell
 * T = T_base(risk) * (1 + beta * A_0) + k(risk) * (1 - I)
 */
export function calculateRequiredDwellMs(
  riskTier: RiskTier,
  intentScore: number,
  amplitudeRms: number
): number {
  // Base dwell per risk tier (ms)
  const baseTable: Record<RiskTier, number> = {
    R0: 800,   // Lamp, Fan (Low risk)
    R1: 1400,  // AC, Blinds, TV (Medium risk)
    R2: 2200,  // Radiant Heater, Geyser, Deadbolt (Critical hazard)
  };

  // Uncertainty penalty multiplier k(risk)
  const kTable: Record<RiskTier, number> = {
    R0: 450,
    R1: 900,
    R2: 1500,
  };

  const baseDwell = baseTable[riskTier];
  const kUncertainty = kTable[riskTier];

  // Tremor scale: Tremor users get a scaled achievable window
  const tremorDwellScale = 1.0 + Math.min(2.5, amplitudeRms * 12.0);
  const adjustedBase = baseDwell * tremorDwellScale;

  // Uncertainty penalty scales inversely with intent score
  const uncertaintyDwell = kUncertainty * (1.0 - intentScore);

  const totalDwellMs = Math.round(adjustedBase + uncertaintyDwell);

  // Hard clamp boundaries
  const maxClampTable: Record<RiskTier, number> = {
    R0: 1600,
    R1: 2800,
    R2: 4500,
  };

  return Math.min(maxClampTable[riskTier], Math.max(600, totalDwellMs));
}

/**
 * Main Intent Gating Engine
 * Evaluates whether a gesture actuation passes or fails under the chosen mode
 * (SteadyGate F1-F5 vs B0 vs B1 vs B2).
 */
export function evaluateIntentGate(input: GateInput): GateDecision {
  const mode = input.baselineMode || "STEADYGATE";
  const user = input.user;
  const appliance = input.appliance;
  const margin =
    input.margin !== undefined
      ? input.margin
      : input.top2Posterior !== undefined
      ? Math.max(0, input.posterior - input.top2Posterior)
      : 0.35;

  const components: IntentComponents = {
    posterior: input.posterior,
    margin,
    attention: input.attention,
    stabilityRaw: input.stabilityRaw,
    stabilityNorm: input.stabilityNorm,
    sceneQuality: input.sceneQuality,
    contextPrior: input.contextPrior,
    fusedIntent: calculateIntentScore({
      posterior: input.posterior,
      margin,
      attention: input.attention,
      stabilityNorm: input.stabilityNorm,
      sceneQuality: input.sceneQuality,
      contextPrior: input.contextPrior,
    }),
  };

  // ==========================================
  // BASELINE B0: Canned MediaPipe + Fixed 0.85
  // ==========================================
  if (mode === "B0_RAW") {
    const fixedDwell = 500;
    const passesConfidence = input.posterior >= 0.85;
    const passesRawStability = input.stabilityRaw >= 0.70;

    if (!passesConfidence) {
      return {
        status: "REJECTED",
        rejectCode: "AMBIGUOUS_CLASS",
        rejectExplanation: `[B0 Baseline] Confidence ${Math.round(input.posterior * 100)}% below fixed 85% threshold.`,
        intentScore: input.posterior,
        intentComponents: components,
        dwellRequiredMs: fixedDwell,
        dwellCompletedMs: input.dwellTimeHeldMs,
        dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
        isAchieved: false,
        requiresSecondaryConfirmation: false,
        isHandshakeReady: false,
      };
    }

    if (!passesRawStability) {
      return {
        status: "REJECTED",
        rejectCode: "GESTURE_UNSTABLE",
        rejectExplanation: `[B0 Baseline] Raw jitter rejected hand movement. Tremor not recognized or compensated.`,
        intentScore: input.posterior,
        intentComponents: components,
        dwellRequiredMs: fixedDwell,
        dwellCompletedMs: input.dwellTimeHeldMs,
        dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
        isAchieved: false,
        requiresSecondaryConfirmation: false,
        isHandshakeReady: false,
      };
    }

    const isAchieved = input.dwellTimeHeldMs >= fixedDwell;
    return {
      status: isAchieved ? "ACTUATED" : "REJECTED",
      rejectCode: isAchieved ? "NONE" : "GESTURE_UNSTABLE",
      rejectExplanation: isAchieved
        ? `[B0 Baseline] Actuated without risk awareness.`
        : `[B0 Baseline] Incomplete hold duration.`,
      intentScore: input.posterior,
      intentComponents: components,
      dwellRequiredMs: fixedDwell,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
      isAchieved,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  // ==========================================
  // BASELINE B1: Wake Gesture State Machine
  // ==========================================
  if (mode === "B1_WAKE_STATE") {
    const fixedDwell = 1200;
    const passesRawStability = input.stabilityRaw >= 0.65;

    if (!passesRawStability) {
      return {
        status: "REJECTED",
        rejectCode: "GESTURE_UNSTABLE",
        rejectExplanation: `[B1 Baseline] Wake gesture broke stability due to hand tremor.`,
        intentScore: components.fusedIntent,
        intentComponents: components,
        dwellRequiredMs: fixedDwell,
        dwellCompletedMs: input.dwellTimeHeldMs,
        dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
        isAchieved: false,
        requiresSecondaryConfirmation: false,
        isHandshakeReady: false,
      };
    }

    const isAchieved = input.dwellTimeHeldMs >= fixedDwell;
    return {
      status: isAchieved ? "ACTUATED" : "REJECTED",
      rejectCode: isAchieved ? "NONE" : "GESTURE_UNSTABLE",
      rejectExplanation: isAchieved
        ? `[B1 Baseline] Wake state completed.`
        : `[B1 Baseline] Wake state timeout.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: fixedDwell,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
      isAchieved,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  // ==========================================
  // BASELINE B2: Microsoft Multi-Level Dwell
  // ==========================================
  if (mode === "B2_FIXED_DWELL") {
    const fixedDwell = appliance.riskTier === "R0" ? 2000 : 4000;
    const passesRawStability = input.stabilityRaw >= 0.60;

    if (!passesRawStability) {
      return {
        status: "REJECTED",
        rejectCode: "GESTURE_UNSTABLE",
        rejectExplanation: `[B2 Baseline] User unable to hold fixed ${fixedDwell / 1000}s still without tremor compensation.`,
        intentScore: components.fusedIntent,
        intentComponents: components,
        dwellRequiredMs: fixedDwell,
        dwellCompletedMs: input.dwellTimeHeldMs,
        dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
        isAchieved: false,
        requiresSecondaryConfirmation: false,
        isHandshakeReady: false,
      };
    }

    const isAchieved = input.dwellTimeHeldMs >= fixedDwell;
    return {
      status: isAchieved ? "ACTUATED" : "REJECTED",
      rejectCode: isAchieved ? "NONE" : "GESTURE_UNSTABLE",
      rejectExplanation: isAchieved
        ? `[B2 Baseline] Fixed dwell elapsed.`
        : `[B2 Baseline] Fixed dwell in progress.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: fixedDwell,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: Math.min(100, (input.dwellTimeHeldMs / fixedDwell) * 100),
      isAchieved,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  // ==========================================
  // OUR INVENTIVE METHOD: STEADYGATE (F1 - F5)
  // ==========================================

  // Step 1: Explainable Rejection Checks (F5)
  if (input.sceneQuality < 0.35) {
    return {
      status: "REJECTED",
      rejectCode: "POOR_LIGHT",
      rejectExplanation: `Scene illuminance (${Math.round(input.sceneQuality * 100)}%) is too low for trustworthy landmark tracking.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: 1500,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: 0,
      isAchieved: false,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  if (input.attention < user.attentionFloor) {
    return {
      status: "REJECTED",
      rejectCode: "LOW_ATTENTION",
      rejectExplanation: `User gaze / head-pose attention (${Math.round(input.attention * 100)}%) is below floor (${Math.round(user.attentionFloor * 100)}%). Looking away from appliance target.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: 1500,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: 0,
      isAchieved: false,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  if (margin < 0.12 || input.posterior < 0.65) {
    return {
      status: "REJECTED",
      rejectCode: "AMBIGUOUS_CLASS",
      rejectExplanation: `Gesture classifier margin is too narrow (${Math.round(margin * 100)}%). Possible ambiguous transition.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: 1500,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: 0,
      isAchieved: false,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  // Signature-Normalized Stability Check (F2)
  if (input.stabilityNorm < 0.50) {
    return {
      status: "REJECTED",
      rejectCode: "TREMOR_EXCEEDS_PROFILE",
      rejectExplanation: `Involuntary motion exceeded user's enrolled profile ($f_0$=${user.f0Hz}Hz, $A_0$=${user.amplitudeRms}). Residual motion unquenched.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs: 1800,
      dwellCompletedMs: input.dwellTimeHeldMs,
      dwellProgressPct: 0,
      isAchieved: false,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  // Step 2: Compute Adaptive Dwell Requirements (F4)
  const dwellRequiredMs = calculateRequiredDwellMs(
    appliance.riskTier,
    components.fusedIntent,
    user.amplitudeRms
  );

  const dwellCompletedMs = input.dwellTimeHeldMs;
  const dwellProgressPct = Math.min(100, Math.round((dwellCompletedMs / dwellRequiredMs) * 100));
  const isAchieved = dwellCompletedMs >= dwellRequiredMs;

  // Step 3: Handle Risk Tier R2 Two-Gesture Confirmation Handshake (F4 Claimed Feature)
  if (appliance.riskTier === "R2") {
    // If secondary handshake gesture is provided:
    if (input.isSecondaryHandshakeGesture) {
      const secondaryDwellRequired = 600;
      const secAchieved = input.dwellTimeHeldMs >= secondaryDwellRequired;
      if (secAchieved) {
        return {
          status: "ACTUATED",
          rejectCode: "NONE",
          rejectExplanation: `R2 Two-Gesture Handshake verified! Intent score ${Math.round(components.fusedIntent * 100)}%. Absolute state command dispatched.`,
          intentScore: components.fusedIntent,
          intentComponents: components,
          dwellRequiredMs: secondaryDwellRequired,
          dwellCompletedMs: input.dwellTimeHeldMs,
          dwellProgressPct: 100,
          isAchieved: true,
          requiresSecondaryConfirmation: false,
          isHandshakeReady: true,
        };
      } else {
        return {
          status: "REJECTED",
          rejectCode: "GESTURE_UNSTABLE",
          rejectExplanation: `Holding secondary handshake (${input.dwellTimeHeldMs}/${secondaryDwellRequired} ms).`,
          intentScore: components.fusedIntent,
          intentComponents: components,
          dwellRequiredMs: secondaryDwellRequired,
          dwellCompletedMs: input.dwellTimeHeldMs,
          dwellProgressPct: Math.round((input.dwellTimeHeldMs / secondaryDwellRequired) * 100),
          isAchieved: false,
          requiresSecondaryConfirmation: true,
          isHandshakeReady: false,
        };
      }
    }

    // Primary gesture hold
    if (isAchieved) {
      return {
        status: "HANDSHAKE_PENDING",
        rejectCode: "NONE",
        rejectExplanation: `R2 HAZARD ESCALATION: Primary intent sustained. Second confirmation gesture (e.g., THUMBS_UP) required within 5s window.`,
        intentScore: components.fusedIntent,
        intentComponents: components,
        dwellRequiredMs,
        dwellCompletedMs: input.dwellTimeHeldMs,
        dwellProgressPct: 100,
        isAchieved: true,
        requiresSecondaryConfirmation: true,
        isHandshakeReady: true,
      };
    } else {
      return {
        status: "REJECTED",
        rejectCode: "GESTURE_UNSTABLE",
        rejectExplanation: `Holding R2 gesture (${dwellCompletedMs}/${dwellRequiredMs} ms, ${dwellProgressPct}%). Keep hand in position.`,
        intentScore: components.fusedIntent,
        intentComponents: components,
        dwellRequiredMs,
        dwellCompletedMs,
        dwellProgressPct,
        isAchieved: false,
        requiresSecondaryConfirmation: true,
        isHandshakeReady: false,
      };
    }
  }

  // Step 4: Handle R0 and R1 appliances
  if (isAchieved) {
    return {
      status: "ACTUATED",
      rejectCode: "NONE",
      rejectExplanation: `${appliance.riskTier} Intent Verified (${Math.round(components.fusedIntent * 100)}%). Dispatched SET command to ${appliance.name}.`,
      intentScore: components.fusedIntent,
      intentComponents: components,
      dwellRequiredMs,
      dwellCompletedMs,
      dwellProgressPct: 100,
      isAchieved: true,
      requiresSecondaryConfirmation: false,
      isHandshakeReady: false,
    };
  }

  return {
    status: "REJECTED",
    rejectCode: "GESTURE_UNSTABLE",
    rejectExplanation: `Dwelling for ${appliance.riskTier} actuation: ${dwellCompletedMs} ms of ${dwellRequiredMs} ms (${dwellProgressPct}%).`,
    intentScore: components.fusedIntent,
    intentComponents: components,
    dwellRequiredMs,
    dwellCompletedMs,
    dwellProgressPct,
    isAchieved: false,
    requiresSecondaryConfirmation: false,
    isHandshakeReady: false,
  };
}
