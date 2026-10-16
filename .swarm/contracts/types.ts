import type { HandLandmark2D, RecognizedGesture } from "../../src/lib/types";

export type Handedness = "Left" | "Right";

export interface PalmOrientation {
  normalX: number;
  normalY: number;
  normalZ: number;
  isPalmar: boolean;
  isDorsal: boolean;
  rollAngleDeg: number;
  pitchAngleDeg: number;
}

export interface LocaleGesturePack {
  countryCode: string;
  countryName: string;
  region: string;
  restrictedGestures: RecognizedGesture[];
  requirePalmarForVictory: boolean;
  avoidPalmarOpenPalmMoutza: boolean;
  remappedIntents: Partial<Record<RecognizedGesture, RecognizedGesture>>;
  culturalNotes: string;
}

export interface LocaleGestureResolution {
  rawGesture: RecognizedGesture;
  effectiveGesture: RecognizedGesture;
  culturallyRestricted: boolean;
  remapped: boolean;
  restrictionReason: string | null;
  countryCode: string;
}

export interface UserAnatomicalCalibration {
  userId?: string;
  minFlexion: [number, number, number, number, number];
  maxExtension: [number, number, number, number, number];
  bedTiltDeg: number;
  boneRatios?: {
    indexToMiddle: number;
    ringToMiddle: number;
    palmWidthToLen: number;
  };
}

export interface CaregiverBiometricVerdict {
  verified: boolean;
  reason: "VERIFIED_USER_HAND" | "CAREGIVER_OR_BYSTANDER_HAND_IGNORED";
  boneRatioDeviation: number;
  wristJumpDelta: number;
}

export interface TimedVoteSample {
  gesture: RecognizedGesture;
  timestampMs: number;
  dtMs: number;
}

export interface TimeWeightedVoteResult {
  committed: RecognizedGesture;
  raw: RecognizedGesture;
  agreement: number;
  windowMs: number;
  accumulatedCommitMs: number;
  streak: number;
}

export type SafetyRiskTier = 1 | 2 | 3;

export type ChordStage =
  | "IDLE"
  | "STEP_1_ARMING_OPEN_PALM"
  | "STEP_1_ARMED_AWAITING_FIST"
  | "STEP_2_COUNTDOWN_HOLD"
  | "CHORD_VERIFIED"
  | "CHORD_ABORTED_BY_USER"
  | "DEVICE_FAULT_LOCK";

export interface SafetyChordState {
  deviceId: string;
  riskTier: SafetyRiskTier;
  stage: ChordStage;
  chordVerified: boolean;
  progressPct: number;
  remainingCountdownMs: number;
  reason: string;
}

export type LanDriverType =
  | "HOME_ASSISTANT_LAN"
  | "MQTT_HTTP_TASMO"
  | "MATTER_LOCAL_RPC"
  | "LOCAL_DB_SIMULATOR";

export interface LanActuationResult {
  ok: boolean;
  deviceId: string;
  driver: LanDriverType;
  command: string;
  simulated: boolean;
  latencyMs: number;
  circuitBreakerState: "CLOSED_HEALTHY" | "OPEN_FAULT_LOCKED";
  reasonCode: string;
  error?: string;
}
