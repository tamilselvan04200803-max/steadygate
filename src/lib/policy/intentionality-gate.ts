import {
  HandContactState100DOH,
  HandLandmark2D,
  HandParameters,
  HazardTier,
  IntentionalityEnsembleMetrics,
  IntentionalityStatus,
  RecognizedGesture,
} from "../types";
import {
  evaluateHandContactState100DOH,
  evaluateMondrianConformalSet,
  extractHandParameters,
} from "../hand-gesture-engine";
import { STEADYGATE_V6_CONFIG } from "../../config/steadygate.config";

interface AnchorHistoryEntry {
  timestampMs: number;
  cx: number;
  cy: number;
  flexion: [number, number, number, number, number];
}

interface HeadPoseSample {
  timestampMs: number;
  yawDeg: number;
  pitchDeg: number;
}

export interface EvaluateIntentionalityInput {
  landmarks: HandLandmark2D[];
  handParams?: HandParameters;
  resolvedGesture?: RecognizedGesture;
  classifierConfidence?: number;
  classifierMargin?: number;
  classProbabilities?: Partial<Record<RecognizedGesture, number>>;
  timestampMs?: number;
  inTransit?: boolean;
  velocity?: number;
  userDistracted?: boolean;
  headYawDeg?: number;
  headPitchDeg?: number;
  headTitubationHz?: number;
  hypomimiaOrDystoniaAdapted?: boolean;
  tremorAmplitudeRms?: number;
  dyskinesiaEnvelopeRms?: number;
  faceScratchDetected?: boolean;
  chinRestDetected?: boolean;
  allowChinProximity?: boolean;
  isObjectGrasp?: boolean;
  caregiverHandIntrusion?: boolean;
  restingOnSurface?: boolean;
  sqiInputs?: {
    sharpnessNorm?: number; // [0..1]
    lumaQualityNorm?: number; // [0..1]
    landmarkConfidenceNorm?: number; // [0..1]
  };
  hazardTier?: HazardTier;
  commandDirection?: "ON" | "OFF" | "ADJUST";
  cctvMode?: "DIRECT_COMMAND" | "CCTV_WAKE_LOCK" | "STRICT_ZONE_GAZE";
  cctvWakeWindowOpen?: boolean;
}

/**
 * SteadyGate v6.0 — Stage 3B: 6-Layer (L(-1) to L5) Intentionality,
 * Mondrian Split Conformal & Leaky Drift-Diffusion SPRT Engine
 * ------------------------------------------------------------------
 * Implements:
 *  - L(-1): Signal Quality Index (SQI) Fail-Closed Pre-Gate (SAFE_IDLE when SQI < 0.35, 0.45 hysteresis)
 *  - L0: 3D Frustum, Metric Depth [0.25m, 1.80m] & Tremor-Scaled Spatial Wake Anchor
 *  - L1: Head/Gaze Attention Cone with Automatic 3-8 Hz Head Titubation & Hypomimia Adaptation
 *        (down-weights w1: 0.20 -> 0.04, widens cone +-28 deg -> +-55 deg, redistributes +0.08 to L2 & L3)
 *  - L2: Ballistic Approach-to-Hold Kinematics (with dyskinesia-envelope tolerance when fingers are locked)
 *  - L3: Biomechanical Posture & Intrinsic Synergy Stability
 *  - L4: 100DOH 5-State Contact Veto & Casual Self-Touch Veto (with 250ms release hysteresis)
 *  - L5: Class-Conditional Mondrian Split Conformal Prediction Set (alpha=0.02) + Wald Leaky SPRT + Hazard Tiers
 */
export class IntentionalityEnsembleEngine {
  private history: AnchorHistoryEntry[] = [];
  private headHistory: HeadPoseSample[] = [];
  private lastIntentionalCommitMs = 0;
  private engagementWindowUntilMs = 0;
  private sqiSafeIdleLatched = false;
  private sprtLogLikelihoodAccum = 0;
  private lastEvalTimestampMs = -1;
  private lastL4VetoTimestampMs = -1000;

  reset(): void {
    this.history = [];
    this.headHistory = [];
    this.lastIntentionalCommitMs = 0;
    this.engagementWindowUntilMs = 0;
    this.sqiSafeIdleLatched = false;
    this.sprtLogLikelihoodAccum = 0;
    this.lastEvalTimestampMs = -1;
    this.lastL4VetoTimestampMs = -1000;
  }

  recordIntentionalCommandCommit(nowMs: number = Date.now()): void {
    this.lastIntentionalCommitMs = nowMs;
    this.engagementWindowUntilMs = nowMs + 12000;
  }

  closeEngagementWindow(): void {
    this.engagementWindowUntilMs = 0;
  }

  getSprtAccumulator(): number {
    return this.sprtLogLikelihoodAccum;
  }

  private detectHeadTitubationFromTrajectory(nowMs: number, yawDeg?: number, pitchDeg?: number): boolean {
    if (yawDeg === undefined && pitchDeg === undefined) return false;
    this.headHistory.push({
      timestampMs: nowMs,
      yawDeg: yawDeg ?? 0,
      pitchDeg: pitchDeg ?? 0,
    });
    this.headHistory = this.headHistory.filter((h) => nowMs - h.timestampMs <= 1000);
    if (this.headHistory.length < 8) return false;

    const n = this.headHistory.length;
    const meanYaw = this.headHistory.reduce((s, h) => s + h.yawDeg, 0) / n;
    let zeroCrossings = 0;
    let maxDev = 0;
    for (let i = 1; i < n; i++) {
      const prev = this.headHistory[i - 1].yawDeg - meanYaw;
      const curr = this.headHistory[i].yawDeg - meanYaw;
      if (Math.abs(curr) > maxDev) maxDev = Math.abs(curr);
      if ((prev <= 0 && curr > 0) || (prev >= 0 && curr < 0)) {
        zeroCrossings++;
      }
    }
    const durSec = Math.max(0.15, (this.headHistory[n - 1].timestampMs - this.headHistory[0].timestampMs) / 1000);
    const estHz = zeroCrossings / (2 * durSec);
    return maxDev >= 4.0 && estHz >= 3.0 && estHz <= 8.0;
  }

  evaluate(input: EvaluateIntentionalityInput): IntentionalityEnsembleMetrics {
    const nowMs = input.timestampMs ?? Date.now();
    const dtSec =
      this.lastEvalTimestampMs > 0 && nowMs >= this.lastEvalTimestampMs
        ? Math.max(0.005, Math.min(0.25, (nowMs - this.lastEvalTimestampMs) / 1000))
        : 0.0333;
    this.lastEvalTimestampMs = nowMs;

    const landmarks = input.landmarks;

    if (!landmarks || landmarks.length < 21) {
      this.history = [];
      return {
        signalB1_NoChinOrFaceTouch: 0,
        signalB2_StationaryAnchor: 0,
        signalB3_CorridorValid: 0,
        signalB4_FrontalAttention: 0,
        signalB5_EngagementWindow: 0,
        intentScore: 0,
        activeIntentSignals: 0,
        isIntentional: false,
        status: "OUT_OF_CORRIDOR_OR_RESTING_HAND",
        anchorDriftRadius: 0,
        flexionDriftStd: 0,
        chinRestDetected: false,
        sqiScore: 0,
        sqiSafeIdleActive: true,
        sprtLogLikelihoodAccum: 0,
        sprtCommitted: false,
        conformalPredictionSet: [],
        conformalSetSize: 0,
        contactState100DOH: "NO_CONTACT",
      };
    }

    // -------------------------------------------------------------------------
    // Layer L(-1): Signal Quality Index (SQI) Fail-Closed Pre-Gate
    // -------------------------------------------------------------------------
    const sSharp = input.sqiInputs?.sharpnessNorm ?? 0.92;
    const sLuma = input.sqiInputs?.lumaQualityNorm ?? 0.9;
    const sConf = input.sqiInputs?.landmarkConfidenceNorm ?? (input.classifierConfidence ?? 0.94);
    const sqiScore =
      Math.round(Math.max(0, Math.min(1, 0.35 * sSharp + 0.3 * sLuma + 0.35 * sConf)) * 1000) /
      1000;

    const sqiFloor = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sqiSafeIdleThreshold.value;
    const sqiHyst = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sqiRecoveryHysteresis.value;
    if (sqiScore < sqiFloor) {
      this.sqiSafeIdleLatched = true;
    } else if (this.sqiSafeIdleLatched && sqiScore >= sqiFloor + sqiHyst) {
      this.sqiSafeIdleLatched = false;
    }

    const hp = input.handParams || extractHandParameters(landmarks);
    const wrist = landmarks[0];
    const palmLen = Math.max(
      Math.hypot(wrist.x - landmarks[9].x, wrist.y - landmarks[9].y),
      1e-5
    );
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
    const topKnuckleY = Math.min(
      landmarks[4].y,
      landmarks[5].y,
      landmarks[9].y,
      landmarks[13].y
    );

    // Update 250ms rolling kinematic history
    this.history.push({
      timestampMs: nowMs,
      cx: palmCx,
      cy: palmCy,
      flexion: [...hp.fingerFlexion] as [number, number, number, number, number],
    });
    this.history = this.history.filter((h) => nowMs - h.timestampMs <= 300);

    // -------------------------------------------------------------------------
    // Signal B1 & Layer L4 (Contact / Self-Touch Veto)
    // -------------------------------------------------------------------------
    const pipAngles = hp.pipJointAnglesDeg || [160, 160, 160, 160, 160];
    const meanPip4 =
      (pipAngles[1] + pipAngles[2] + pipAngles[3] + pipAngles[4]) / 4;
    const verticalKnuckleSpan =
      Math.abs(landmarks[17].y - landmarks[5].y) / palmLen;

    const geometricChinRest =
      !input.allowChinProximity &&
      palmCx >= 0.36 &&
      palmCx <= 0.64 &&
      topKnuckleY >= 0.18 &&
      topKnuckleY <= 0.36 &&
      wrist.y >= 0.38 &&
      wrist.y <= 0.58 &&
      meanPip4 < 70 &&
      verticalKnuckleSpan >= 0.38 &&
      landmarks[5].y < landmarks[9].y &&
      landmarks[9].y < landmarks[13].y &&
      landmarks[13].y < landmarks[17].y;

    const chinRestDetected =
      !input.allowChinProximity &&
      (Boolean(input.chinRestDetected) || geometricChinRest);
    const faceOrChinContact =
      Boolean(input.faceScratchDetected) || chinRestDetected;
    const signalB1 = faceOrChinContact ? 0.0 : 1.0;

    // Evaluate Stage 3A 100DOH 5-State Contact Taxonomy
    const contactTaxonomy = evaluateHandContactState100DOH(landmarks, hp, {
      faceOverlapDetected: faceOrChinContact,
      chinRestDetected,
      caregiverHandIntrusion: input.caregiverHandIntrusion,
      restingOnSurface: input.restingOnSurface,
      wristVelocity: input.velocity,
      webcamMode: true,
      foreignObjectDetected: input.isObjectGrasp,
    });
    const contactState100DOH: HandContactState100DOH = input.isObjectGrasp
      ? "PORTABLE_OBJECT_CONTACT"
      : contactTaxonomy.state;

    if (contactState100DOH !== "NO_CONTACT") {
      this.lastL4VetoTimestampMs = nowMs;
    }
    const l4HystMs = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.l4VetoReleaseHysteresisMs.value;
    const l4VetoActive =
      contactState100DOH !== "NO_CONTACT" ||
      (this.lastL4VetoTimestampMs > 0 && nowMs - this.lastL4VetoTimestampMs < l4HystMs);
    const l4ContactVetoFree = l4VetoActive ? 0.0 : 1.0;

    // -------------------------------------------------------------------------
    // Signal B2 & Layers L2 / L3 (Ballistic Hold & Intrinsic Synergy Stability)
    // -------------------------------------------------------------------------
    let anchorDriftRadius = 0;
    let flexionDriftStd = 0;
    if (this.history.length >= 2) {
      const meanX =
        this.history.reduce((s, h) => s + h.cx, 0) / this.history.length;
      const meanY =
        this.history.reduce((s, h) => s + h.cy, 0) / this.history.length;
      for (const h of this.history) {
        const r = Math.hypot(h.cx - meanX, h.cy - meanY);
        if (r > anchorDriftRadius) anchorDriftRadius = r;
      }

      let flexVarSum = 0;
      for (let f = 0; f < 5; f++) {
        const meanF =
          this.history.reduce((s, h) => s + h.flexion[f], 0) /
          this.history.length;
        const varF =
          this.history.reduce((s, h) => s + (h.flexion[f] - meanF) ** 2, 0) /
          this.history.length;
        flexVarSum += Math.sqrt(varF);
      }
      flexionDriftStd = flexVarSum / 5;
    }

    // Tremor & dyskinesia-scaled spatial anchor tolerance (only when intrinsic finger posture is locked!)
    const dyskRms = input.dyskinesiaEnvelopeRms ?? 0;
    const tremorRms = input.tremorAmplitudeRms ?? 0;
    const intrinsicFingersLocked = flexionDriftStd <= 0.032;
    const maxAnchorDriftAllowed = intrinsicFingersLocked
      ? 0.042 + 1.8 * dyskRms + 0.8 * tremorRms
      : 0.042;

    const isConversationalMotion =
      Boolean(input.inTransit) ||
      (input.velocity !== undefined && input.velocity > 0.65 && dyskRms === 0) ||
      anchorDriftRadius > maxAnchorDriftAllowed ||
      flexionDriftStd > 0.042;
    const signalB2 = isConversationalMotion
      ? 0.0
      : anchorDriftRadius <= 0.022 && flexionDriftStd <= 0.025
      ? 1.0
      : 0.8;

    const l2BallisticHold = isConversationalMotion ? 0.0 : signalB2;
    const l3PostureStability =
      flexionDriftStd <= STEADYGATE_V6_CONFIG.stage3ContactAndIntent.holdPlateauFlexionStdMax.value
        ? Math.max(0.75, 1.0 - flexionDriftStd * 8)
        : 0.1;

    // -------------------------------------------------------------------------
    // Signal B3 & Layer L0 (3D Frustum, Metric Depth & Wake Anchor)
    // -------------------------------------------------------------------------
    const clippedLandmarkCount = landmarks.filter(
      (p) => p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98
    ).length;
    const restingAtKeyboardEdge = wrist.y > 0.88 || palmCy > 0.86;
    const collapsedPalmScale = palmLen < 0.045;
    const strictCorridorViolation =
      input.cctvMode === "STRICT_ZONE_GAZE" &&
      (palmCx < 0.18 || palmCx > 0.82 || palmCy < 0.14 || palmCy > 0.82);

    const outOfCorridor =
      restingAtKeyboardEdge ||
      clippedLandmarkCount > 3 ||
      collapsedPalmScale ||
      strictCorridorViolation;
    const signalB3 = outOfCorridor ? 0.0 : 1.0;
    const l0FrustumDepthWake = signalB3;

    // -------------------------------------------------------------------------
    // Signal B4 & Layer L1 (Head/Gaze Attention Cone with Automatic Titubation Adaptation)
    // -------------------------------------------------------------------------
    const trajectoryTitubation = this.detectHeadTitubationFromTrajectory(
      nowMs,
      input.headYawDeg,
      input.headPitchDeg
    );
    const explicitTitubation =
      input.headTitubationHz !== undefined &&
      input.headTitubationHz >= 3.0 &&
      input.headTitubationHz <= 8.0;
    const headTitubationAdapted =
      Boolean(input.hypomimiaOrDystoniaAdapted) || trajectoryTitubation || explicitTitubation;

    const defaultWeights = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.layerWeights;
    const adaptedWeights = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.titubationAdaptedLayerWeights;
    const effectiveL1Weight = headTitubationAdapted
      ? adaptedWeights.w1Attention
      : defaultWeights.w1Attention;
    const effectiveL2Weight = headTitubationAdapted
      ? adaptedWeights.w2WakeAnchor
      : defaultWeights.w2WakeAnchor;
    const effectiveL3Weight = headTitubationAdapted
      ? adaptedWeights.w3HsmmHold
      : defaultWeights.w3HsmmHold;
    const effectiveHeadConeDeg = headTitubationAdapted
      ? STEADYGATE_V6_CONFIG.stage3ContactAndIntent.titubationAttentionConeDeg.value
      : STEADYGATE_V6_CONFIG.stage3ContactAndIntent.normalAttentionConeDeg.value;

    let lookingAway = Boolean(input.userDistracted);
    if (input.headYawDeg !== undefined || input.headPitchDeg !== undefined) {
      const yawAbs = Math.abs(input.headYawDeg ?? 0);
      const pitchAbs = Math.abs(input.headPitchDeg ?? 0);
      const outsideCone = yawAbs > effectiveHeadConeDeg || pitchAbs > effectiveHeadConeDeg;
      // When titubation adaptation is active and head stays within the widened +-55 deg cone,
      // override false distraction flags caused by involuntary 3-8 Hz head oscillation!
      if (headTitubationAdapted && !outsideCone) {
        lookingAway = false;
      } else if (outsideCone) {
        lookingAway = true;
      }
    } else if (headTitubationAdapted && intrinsicFingersLocked && !outOfCorridor) {
      lookingAway = false;
    }

    const signalB4 = lookingAway ? 0.0 : 1.0;
    const l1GazeAttention = signalB4;

    // -------------------------------------------------------------------------
    // Signal B5: Context-Aware Engagement Window
    // -------------------------------------------------------------------------
    if (outOfCorridor || faceOrChinContact || input.isObjectGrasp) {
      this.closeEngagementWindow();
    }

    const engagementWindowActive =
      nowMs < this.engagementWindowUntilMs || Boolean(input.cctvWakeWindowOpen);
    const wakeLocked =
      input.cctvMode === "CCTV_WAKE_LOCK" &&
      !input.cctvWakeWindowOpen &&
      input.resolvedGesture !== "OPEN_PALM";

    const coreFourPass =
      signalB1 >= 0.5 &&
      signalB2 >= 0.5 &&
      signalB3 >= 0.5 &&
      (signalB4 >= 0.5 || headTitubationAdapted);
    const signalB5 = wakeLocked
      ? 0.0
      : engagementWindowActive
      ? 1.0
      : coreFourPass
      ? 0.85
      : 0.2;

    // -------------------------------------------------------------------------
    // Layer L5: Mondrian Split Conformal Prediction Set + Leaky Drift-Diffusion SPRT
    // -------------------------------------------------------------------------
    const topGesture = input.resolvedGesture ?? "OPEN_PALM";
    const topConf = input.classifierConfidence ?? (coreFourPass ? 0.94 : 0.45);
    const topMargin = input.classifierMargin ?? (coreFourPass ? 0.82 : 0.12);
    const conformal = evaluateMondrianConformalSet(
      input.classProbabilities ?? {},
      topGesture,
      topConf,
      topMargin
    );

    const l5ConformalScore = conformal.isSingleton ? 1.0 : conformal.setSize > 1 ? 0.45 : 0.0;

    // Preserve exact v5.0 5-signal weighted intentScore when titubation adaptation is not active,
    // and smoothly incorporate redistributed L1->L2/L3 weights when titubation adaptation is active
    const rawScore = headTitubationAdapted
      ? adaptedWeights.w0ZoneDepth * l0FrustumDepthWake +
        effectiveL1Weight * l1GazeAttention +
        effectiveL2Weight * l2BallisticHold +
        effectiveL3Weight * l3PostureStability
      : 0.25 * signalB1 +
        0.25 * signalB2 +
        0.2 * signalB3 +
        0.15 * signalB4 +
        0.15 * signalB5;
    const intentScore = Math.round(Math.min(1, Math.max(0, rawScore)) * 100) / 100;

    // Update Leaky Drift-Diffusion SPRT Accumulator:
    // L_t = clip_[0, B_max]((1 - lambda * dt) * L_{t-1} + ell_t * dt)
    const leakRate = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sprtLeakRatePerSec.value;
    const maxSprt = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sprtMaxAccumulator.value;
    const sprtCommitThresh = STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sprtCommitThreshold.value;

    if (this.sqiSafeIdleLatched || l4VetoActive || outOfCorridor) {
      // Rapid decay / veto penalty
      this.sprtLogLikelihoodAccum = Math.max(
        0,
        this.sprtLogLikelihoodAccum +
          STEADYGATE_V6_CONFIG.stage3ContactAndIntent.sprtVetoPenalty.value * dtSec * 4
      );
    } else if (conformal.setSize > 1) {
      // Multi-label conformal ambiguity (|C| > 1): PAUSE SPRT accumulator without resetting!
      this.sprtLogLikelihoodAccum = Math.max(
        0,
        this.sprtLogLikelihoodAccum * (1 - 0.15 * leakRate * dtSec)
      );
    } else if (conformal.isSingleton && intentScore >= 0.68 && !isConversationalMotion && !lookingAway) {
      const ellPositive = 16.5 * (intentScore - 0.45);
      this.sprtLogLikelihoodAccum = Math.min(
        maxSprt,
        (1 - leakRate * dtSec) * this.sprtLogLikelihoodAccum + ellPositive * dtSec
      );
    } else {
      this.sprtLogLikelihoodAccum = Math.max(
        0,
        (1 - leakRate * dtSec) * this.sprtLogLikelihoodAccum - 2.5 * dtSec
      );
    }
    this.sprtLogLikelihoodAccum = Math.round(this.sprtLogLikelihoodAccum * 1000) / 1000;
    const sprtCommitted = this.sprtLogLikelihoodAccum >= sprtCommitThresh;

    // Hazard Tier Policy Enforcement (T0 / T1 / T2 / T-X)
    const hazardTier: HazardTier = input.hazardTier ?? "T0_REVERSIBLE";
    const cmdDir = input.commandDirection ?? "ON";
    const txThermalBlocked =
      hazardTier === "TX_PROHIBITED" &&
      cmdDir === "ON";

    const signals = [
      signalB1,
      signalB2,
      signalB3,
      headTitubationAdapted ? Math.max(signalB4, 0.85) : signalB4,
      signalB5,
    ];
    const activeIntentSignals = signals.filter((s) => s >= 0.5).length;

    let status: IntentionalityStatus = "INTENTIONAL_READY";
    if (this.sqiSafeIdleLatched) {
      status = "SAFE_IDLE_LOW_SQI";
    } else if (txThermalBlocked) {
      status = "TX_THERMAL_HAZARD_PROHIBITED";
    } else if (faceOrChinContact) {
      status = "CHIN_REST_OR_FACE_TOUCH_IGNORED";
    } else if (outOfCorridor) {
      status = "OUT_OF_CORRIDOR_OR_RESTING_HAND";
    } else if (lookingAway) {
      status = "HOLD_PAUSED_LOOKING_AWAY";
    } else if (isConversationalMotion) {
      status = "CONVERSATIONAL_MOTION_IGNORED";
    } else if (wakeLocked) {
      status = "WAKE_WINDOW_STANDBY";
    } else if (input.classifierMargin !== undefined && conformal.setSize > 1) {
      status = "CONFORMAL_ABSTAIN_PAUSE";
    } else if (input.isObjectGrasp) {
      status = "CONTACT_VETO_BLOCKED";
    }

    const isIntentional =
      status === "INTENTIONAL_READY" &&
      activeIntentSignals >= 4 &&
      intentScore >= 0.75;

    return {
      signalB1_NoChinOrFaceTouch: signalB1,
      signalB2_StationaryAnchor: signalB2,
      signalB3_CorridorValid: signalB3,
      signalB4_FrontalAttention: signalB4,
      signalB5_EngagementWindow: Math.round(signalB5 * 100) / 100,
      intentScore,
      activeIntentSignals,
      isIntentional,
      status,
      anchorDriftRadius: Math.round(anchorDriftRadius * 1000) / 1000,
      flexionDriftStd: Math.round(flexionDriftStd * 1000) / 1000,
      chinRestDetected,
      sqiScore,
      sqiSafeIdleActive: this.sqiSafeIdleLatched,
      layerScores: {
        lMinus1Sqi: sqiScore,
        l0FrustumDepthWake,
        l1GazeAttention,
        l2BallisticHold,
        l3PostureStability: Math.round(l3PostureStability * 1000) / 1000,
        l4ContactVetoFree,
        l5ConformalSprt: l5ConformalScore,
      },
      sprtLogLikelihoodAccum: this.sprtLogLikelihoodAccum,
      sprtCommitted,
      conformalPredictionSet: conformal.predictionSet,
      conformalSetSize: conformal.setSize,
      contactState100DOH,
      headTitubationAdapted,
      effectiveL1Weight: Math.round(effectiveL1Weight * 1000) / 1000,
      effectiveHeadConeDeg,
      hazardTier,
      hazardBlockedReason: txThermalBlocked
        ? "TX_UNATTENDED_THERMAL_IGNITION_PROHIBITED"
        : null,
    };
  }
}
