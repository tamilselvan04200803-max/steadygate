import {
  HandLandmark2D,
  HandParameters,
  IntentionalityEnsembleMetrics,
  IntentionalityStatus,
  RecognizedGesture,
} from "../types";
import { extractHandParameters } from "../hand-gesture-engine";

interface AnchorHistoryEntry {
  timestampMs: number;
  cx: number;
  cy: number;
  flexion: [number, number, number, number, number];
}

export interface EvaluateIntentionalityInput {
  landmarks: HandLandmark2D[];
  handParams?: HandParameters;
  resolvedGesture?: RecognizedGesture;
  timestampMs?: number;
  inTransit?: boolean;
  velocity?: number;
  userDistracted?: boolean;
  faceScratchDetected?: boolean;
  chinRestDetected?: boolean;
  allowChinProximity?: boolean;
  isObjectGrasp?: boolean;
  cctvMode?: "DIRECT_COMMAND" | "CCTV_WAKE_LOCK" | "STRICT_ZONE_GAZE";
  cctvWakeWindowOpen?: boolean;
}

/**
 * Phase 3 — Ensemble B: 5-Signal Unintentional & Casual Gesture Rejection Engine
 * Automatically rejects unintentional, conversational, chin-resting, keyboard-margin,
 * or distracted gestures without mislabeling them as object grasps.
 */
export class IntentionalityEnsembleEngine {
  private history: AnchorHistoryEntry[] = [];
  private lastIntentionalCommitMs = 0;
  private engagementWindowUntilMs = 0;

  reset(): void {
    this.history = [];
    this.lastIntentionalCommitMs = 0;
    this.engagementWindowUntilMs = 0;
  }

  recordIntentionalCommandCommit(nowMs: number = Date.now()): void {
    this.lastIntentionalCommitMs = nowMs;
    this.engagementWindowUntilMs = nowMs + 12000;
  }

  closeEngagementWindow(): void {
    this.engagementWindowUntilMs = 0;
  }

  evaluate(input: EvaluateIntentionalityInput): IntentionalityEnsembleMetrics {
    const nowMs = input.timestampMs ?? Date.now();
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
      };
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
    // Signal B1 (weight 0.25): Face, Mouth & Chin-Rest Exclusion Halo
    // -------------------------------------------------------------------------
    const pipAngles = hp.pipJointAnglesDeg || [160, 160, 160, 160, 160];
    const meanPip4 =
      (pipAngles[1] + pipAngles[2] + pipAngles[3] + pipAngles[4]) / 4;
    const verticalKnuckleSpan =
      Math.abs(landmarks[17].y - landmarks[5].y) / palmLen;

    // Detect chin-propping fist posture high in central chin/mouth zone (or photometric chin contact)
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

    // -------------------------------------------------------------------------
    // Signal B2 (weight 0.25): Deliberate Raise-and-Freeze vs. Conversational Wave
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

    const isConversationalMotion =
      Boolean(input.inTransit) ||
      (input.velocity !== undefined && input.velocity > 0.65) ||
      anchorDriftRadius > 0.042 ||
      flexionDriftStd > 0.042;
    const signalB2 = isConversationalMotion
      ? 0.0
      : anchorDriftRadius <= 0.022 && flexionDriftStd <= 0.025
      ? 1.0
      : 0.8;

    // -------------------------------------------------------------------------
    // Signal B3 (weight 0.20): Active Presentation Corridor & Border Clipping Gate
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

    // -------------------------------------------------------------------------
    // Signal B4 (weight 0.15): Frontal Visual Attention Verification
    // -------------------------------------------------------------------------
    const lookingAway = Boolean(input.userDistracted);
    const signalB4 = lookingAway ? 0.0 : 1.0;

    // -------------------------------------------------------------------------
    // Signal B5 (weight 0.15): Context-Aware Engagement Window
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
      signalB1 >= 0.5 && signalB2 >= 0.5 && signalB3 >= 0.5 && signalB4 >= 0.5;
    const signalB5 = wakeLocked
      ? 0.0
      : engagementWindowActive
      ? 1.0
      : coreFourPass
      ? 0.85
      : 0.2;

    const rawScore =
      0.25 * signalB1 +
      0.25 * signalB2 +
      0.2 * signalB3 +
      0.15 * signalB4 +
      0.15 * signalB5;
    const intentScore = Math.round(Math.min(1, Math.max(0, rawScore)) * 100) / 100;

    const signals = [signalB1, signalB2, signalB3, signalB4, signalB5];
    const activeIntentSignals = signals.filter((s) => s >= 0.5).length;

    let status: IntentionalityStatus = "INTENTIONAL_READY";
    if (faceOrChinContact) {
      status = "CHIN_REST_OR_FACE_TOUCH_IGNORED";
    } else if (outOfCorridor) {
      status = "OUT_OF_CORRIDOR_OR_RESTING_HAND";
    } else if (lookingAway) {
      status = "HOLD_PAUSED_LOOKING_AWAY";
    } else if (isConversationalMotion) {
      status = "CONVERSATIONAL_MOTION_IGNORED";
    } else if (wakeLocked) {
      status = "WAKE_WINDOW_STANDBY";
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
    };
  }
}
