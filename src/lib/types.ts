export type RiskTier = "R0" | "R1" | "R2";

export type BaselineMode = "STEADYGATE" | "B0_RAW" | "B1_WAKE_STATE" | "B2_FIXED_DWELL";

export type RecognizedGesture =
  | "OPEN_PALM"
  | "THUMBS_UP"
  | "VICTORY"
  | "POINTING_UP"
  | "FIST"
  | "THUMBS_DOWN"
  | "PINCH"
  | "CALL_ME"
  | "THREE_FINGERS"
  | "FOUR_FINGERS"
  | "UNKNOWN";

export type RejectCode =
  | "NONE"
  | "TREMOR_EXCEEDS_PROFILE"
  | "LOW_ATTENTION"
  | "AMBIGUOUS_CLASS"
  | "POOR_LIGHT"
  | "OUT_OF_ZONE"
  | "HANDSHAKE_TIMEOUT"
  | "GESTURE_UNSTABLE";

export interface MotionSignature {
  f0Hz: number; // Dominant tremor frequency (3-12 Hz)
  amplitudeRms: number; // Baseline RMS amplitude
  notchBandwidthHz: number; // Notch filter width (e.g., 2.0 Hz -> f0 ± 1 Hz)
  attentionFloor: number; // Minimum attention required (0.0 - 1.0)
  adaptiveDwellFactor: number; // Scaling factor for dwell
}

export interface HandLandmark2D {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface HandParameters {
  palmWidth: number;
  palmLength: number;
  spanRatio: number;
  fingerFlexion: [number, number, number, number, number]; // thumb, index, middle, ring, pinky (0: fully bent, 1: fully extended)
  aspectRatio: number;
  tiltAngleDeg: number;
  pipJointAnglesDeg?: [number, number, number, number, number];
  mcpJointAnglesDeg?: [number, number, number, number];
  thumbIndexCAperture?: number;
  thumbToMcpDistances?: { d4_5: number; d4_9: number; d4_13: number; d4_17: number };
  interFingerTipDistances?: {
    thumbIndex: number;
    indexMiddle: number;
    middleRing: number;
    ringPinky: number;
    thumbPinkySpan: number;
  };
  normalHandSize?: number;
  handDistanceEstimate?: number;
  /** v5.0 Signed Palmar Thumb-Tuck Coordinate: <= 0 when thumb is outside index MCP (OPEN_PALM), >= 0.24 when tucked across palm (FOUR_FINGERS) */
  thumbPalmarTuckRatio?: number;
  /** v5.0 Signed perpendicular cross-product distance from Index MCP (5) to Thumb Tip (4) relative to palm across-axis */
  thumbTipToIndexMcpCrossDist?: number;
  /** v5.0 Normalized thumb-IP (3) to index-PIP (6) teardrop eyelet arch spread */
  pinchEyeletSpread?: number;
  /** v5.0 True when dual-manifold teardrop pinch eyelet invariant is satisfied */
  isCanonicalPinchEyelet?: boolean;
}

export type GestureLabel = RecognizedGesture;

export type ObjectGraspRejectionReason =
  | "NONE"
  | "BOOK_OR_OBJECT_GRASP"
  | "OPEN_BOOK_PAGE_HOLD"
  | "CYLINDRICAL_CUP_OR_PHONE_GRASP"
  | "PALM_OCCLUDED_BY_OBJECT"
  | "LUMBRICAL_BOOK_CLAMP"
  | "ADMIN_LEARNED_NEGATIVE_GRASP"
  | "WIDE_PHONE_OR_OBJECT_CLASP"
  | "SIDE_EDGE_BOOK_OR_OBJECT_CLAMP"
  | "AGENT_SELF_HEALED_OBJECT_RULE"
  | "CASUAL_FACE_TOUCH_OR_SCRATCH"
  | "CAREGIVER_OR_BYSTANDER_HAND_IGNORED";

export interface ObjectPresenceEnsembleMetrics {
  /** S_A1 [0..1]: Interior grasp zone vs. knuckle self-skin YCbCr divergence (0 = pure self-skin, 1 = foreign object color/mass) */
  signalA1_SkinDivergence: number;
  /** S_A2 [0..1]: Physical gap & wide-clamp biomechanical obstruction */
  signalA2_GapObstruction: number;
  /** S_A3 [0..1]: Protruding linear object boundary (collinear Sobel edge lines extending beyond fingers) */
  signalA3_ProtrudingEdgeLines: number;
  /** S_A4 [0..1]: MCP-flexed / PIP-flat surface clamp dissociation */
  signalA4_McpPipDissociation: number;
  /** S_A5 [0..1]: Inter-finger clamp spacing rigidity */
  signalA5_ClampRigidity: number;
  /** Weighted ensemble score S_object in [0..1] */
  ensembleScore: number;
  /** Number of independent signals >= 0.45 */
  activeSignalCount: number;
  /** True when bare-fist immunity gate exempts the frame */
  isCanonicalBareFist: boolean;
  /** True when ensemble confirms a physical object is in the hand */
  confirmedObjectInHand: boolean;
  /** v5.0 16-ray boundary-crossing object protrusion score [0..1] */
  protrusionScore?: number;
  /** v5.0 True when interior finger curl matches dorsal knuckle skin and 0 boundary protrusions */
  bareHandConfirmed?: boolean;
  /** v5.0 True when temporal ObjectCarryStateTracker has latched object carry across frames */
  carryingObjectLatched?: boolean;
}

export type IntentionalityStatus =
  | "INTENTIONAL_READY"
  | "CHIN_REST_OR_FACE_TOUCH_IGNORED"
  | "CONVERSATIONAL_MOTION_IGNORED"
  | "OUT_OF_CORRIDOR_OR_RESTING_HAND"
  | "HOLD_PAUSED_LOOKING_AWAY"
  | "WAKE_WINDOW_STANDBY";

export interface IntentionalityEnsembleMetrics {
  /** S_B1 [0..1]: 1.0 when hand is free of face/nose/chin-rest contact halo, 0.0 when resting on chin or touching face */
  signalB1_NoChinOrFaceTouch: number;
  /** S_B2 [0..1]: 1.0 when palm centroid & finger flexion are stationary (deliberate command freeze), 0.0 during conversational waving */
  signalB2_StationaryAnchor: number;
  /** S_B3 [0..1]: 1.0 when inside active presentation corridor without border clipping or keyboard-edge resting */
  signalB3_CorridorValid: number;
  /** S_B4 [0..1]: 1.0 when user is facing screen/camera, 0.0 when looking away */
  signalB4_FrontalAttention: number;
  /** S_B5 [0..1]: 1.0 when engagement window is active or high-confidence wake threshold met */
  signalB5_EngagementWindow: number;
  /** Weighted intentionality score S_intent in [0..1] */
  intentScore: number;
  /** Number of intentionality signals >= 0.50 */
  activeIntentSignals: number;
  /** Whether the frame is accepted as an intentional command posture */
  isIntentional: boolean;
  /** Explicit diagnostic status for HUD & voter gating */
  status: IntentionalityStatus;
  /** Spatial anchor drift radius over rolling 250ms window */
  anchorDriftRadius: number;
  /** Intrinsic finger flexion standard deviation over rolling 250ms window */
  flexionDriftStd: number;
  /** True when chin-rest or perioral proximity was detected */
  chinRestDetected: boolean;
}

export interface ExtractedFrameTelemetry {
  frameId: string;
  capturedAtIso: string;
  classification: {
    resolvedGesture: GestureLabel;
    confidence: number; // [0..1] real classifier score
    marginOverRunnerUp: number; // [0..1] score1 - score2
    runnerUpGesture: GestureLabel;
  };
  biomechanics: {
    fingerExtensions: [number, number, number, number, number]; // [thumb, idx, mid, rng, pnk]
    pipJointAnglesDeg: [number, number, number, number, number]; // Real 3-point joint angles
    mcpJointAnglesDeg: [number, number, number, number]; // [idx, mid, rng, pnk] MCP fold
    palmScaleNormalized: number;
    palmAspectRatio: number;
    thumbIndexCAperture: number;
    thumbToMcpDistances: { d4_5: number; d4_9: number; d4_13: number; d4_17: number };
    normalHandSize?: number;
    handDistanceEstimate?: number;
    interFingerTipDistances?: {
      thumbIndex: number;
      indexMiddle: number;
      middleRing: number;
      ringPinky: number;
      thumbPinkySpan: number;
    };
  };
  objectHoldVerification: {
    confirmedObjectInHand: boolean;
    apertureOccupancyRatio: number; // Real visual/contact evidence score
    rejectionReason: ObjectGraspRejectionReason;
  };
  tremorAndKinematics: {
    dominantTremorHz: number; // Real extracted f0 from sliding window
    tremorAmplitudeRms: number;
    spectralConcentration: number;
    normalizedStability: number;
    lockStage: "INITIALIZED_60S_CALIB" | "OBSERVING_CONFIRMATION" | "FINALIZED_LOCKED";
  };
  sceneOptics: {
    luminanceMean: number;
    contrastStd: number;
    snrDb: number;
    appliedGamma: number;
    claheGain: number;
  };
}

export interface UserProfile {
  id: string;
  name: string;
  condition: string;
  f0Hz: number;
  amplitudeRms: number;
  notchBandwidthHz: number;
  attentionFloor: number;
  adaptiveDwellFactor: number;
  medicationPhase: string;
  palmScale?: number;
  fingerFlexibility?: number;
  personalizedPrototypes?: string | null;
  lastCalibratedAt?: string | null;
  createdAt?: string;
}

export interface Appliance {
  id: string;
  name: string;
  category: string;
  riskTier: RiskTier;
  powerState: "ON" | "OFF" | "STANDBY";
  targetValue: number;
  unit: string;
  location: string;
  requiresHandshake: boolean;
  hazardDescription: string;
  iconName: string;
  // IoT Physical Telemetry
  fanSpeed: number; // 0-4
  temperature: number; // °C
  airRpm: number; // RPM
  airflowCfm: number; // CFM
  brightness: number; // 0-100%
  activeWattage: number; // Watts
  espPin: number;
  mqttTopic: string;
  updatedAt: string;
}

export interface IntentComponents {
  posterior: number; // P(gesture) e.g. 0.92
  margin: number; // top1 - top2 margin e.g. 0.35
  attention: number; // Head pose / gaze attention e.g. 0.88
  stabilityRaw: number; // Raw motion stillness (0-1)
  stabilityNorm: number; // Signature-normalized stillness (0-1)
  sceneQuality: number; // Lux / contrast rating (0-1)
  contextPrior: number; // Device context / time-of-day prior (0-1)
  fusedIntent: number; // Calibrated Intent Score I in [0, 1]
}

export interface DwellPolicy {
  baseDwellMs: number;
  adaptiveDwellMs: number;
  dwellProgressPct: number;
  isAchieved: boolean;
  requiresHandshake: boolean;
  handshakeStep?: "PRIMARY_PENDING" | "SECONDARY_REQUIRED" | "COMPLETED";
}

export interface ActuationResult {
  commandId: string;
  status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING";
  rejectCode: RejectCode;
  rejectExplanation: string;
  intentScore: number;
  intentComponents: IntentComponents;
  dwellRequiredMs: number;
  dwellCompletedMs: number;
  appliance: Appliance;
  wasReAttempt: boolean;
  calibratedNudge: boolean;
  timestamp: string;
  mqttMessage?: {
    topic: string;
    payload: Record<string, unknown>;
    qos: number;
    gpioPin: number;
    roundTripMs: number;
  };
}

export interface ActuationLogItem {
  id: string;
  applianceId: string;
  applianceName: string;
  userId: string;
  userName: string;
  gesture: string;
  targetCommand: string;
  riskTier: RiskTier;
  intentScore: number;
  posterior: number;
  margin: number;
  attention: number;
  stabilityRaw: number;
  stabilityNorm: number;
  sceneQuality: number;
  contextPrior: number;
  dwellTimeMs: number;
  dwellRequiredMs: number;
  baselineMode: BaselineMode;
  status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING";
  rejectCode: RejectCode;
  wasReAttempt: boolean;
  calibratedNudge: boolean;
  createdAt: string;
}

export interface SpectrumDataPoint {
  freqHz: number;
  magnitude: number;
  isPeak: boolean;
  inNotchBand: boolean;
}
