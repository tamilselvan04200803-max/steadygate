import { z } from "zod";

export type ParameterProvenance =
  | "heuristic"
  | "fit:hagrid_real_benchmark/calibration_v6"
  | "physics:iec_mains_50_60hz"
  | "anatomy:kapandji_coupled_dip_pip"
  | "stat:wald_sprt_alpha_0.001_beta_0.02"
  | "stat:mondrian_conformal_alpha_0.02";

export interface TunableParameter<T = number> {
  value: T;
  unit: string;
  provenance: ParameterProvenance;
  normalization: "palm_length_norm" | "radians_or_deg" | "seconds_or_ms" | "unitless_ratio" | "hz" | "db" | "meters";
  description: string;
}

export interface SteadyGateV6Config {
  version: "6.0.0";
  regulatoryPositioning: {
    classification: "GENERAL_WELLNESS_ASSISTIVE_CONTROL";
    isMedicalDeviceSaMD: false;
    terminologyPolicy: "Use tremor-adaptive, hand-steadiness trends, and non-diagnostic assistive calibration. Never claim clinical diagnosis, treatment, or staging.";
  };
  features: {
    enableWebGpu: boolean;
    clinicalHeadGazeFallbackMode: boolean;
    researchTelemetryOptIn: boolean;
    disallowUnattendedThermalGestureOn: boolean;
  };
  frameBudgetMs: {
    totalCeilingMs: TunableParameter<number>;
    oursSyncCeilingMs: TunableParameter<number>;
    stage1OpticalMaxMs: TunableParameter<number>;
    stage2KinematicsMaxMs: TunableParameter<number>;
    stage3ContactIntentMaxMs: TunableParameter<number>;
    stage4SignalFilterMaxMs: TunableParameter<number>;
    stage5ActuationHudMaxMs: TunableParameter<number>;
    maxAsyncWorkerStalenessMs: TunableParameter<number>;
  };
  stage1Optical: {
    defaultMainsHz: TunableParameter<50 | 60>;
    shutterPeriod50HzMs: TunableParameter<number>;
    shutterPeriod60HzMs: TunableParameter<number>;
    shutterQuantizationToleranceRatio: TunableParameter<number>;
    criticalDarkLumaFloor: TunableParameter<number>;
    lowLightLumaGate: TunableParameter<number>;
    glareContrastStdGate: TunableParameter<number>;
    glarePixelRatioGate: TunableParameter<number>;
    gammaMin: TunableParameter<number>;
    gammaMax: TunableParameter<number>;
    guidedFilterRadiusPx: TunableParameter<number>;
    guidedFilterEps: TunableParameter<number>;
    claheClipLimit: TunableParameter<number>;
    maxChromaDriftDeltaCbCr: TunableParameter<number>;
    flickerConfidenceGate: TunableParameter<number>;
    flickerGainMin: TunableParameter<number>;
    flickerGainMax: TunableParameter<number>;
    relativeBlurSharpnessRatio: TunableParameter<number>;
    blurKalmanNoiseMultiplier: TunableParameter<number>;
  };
  stage2Kinematics: {
    defaultDipPipCouplingCoeff: TunableParameter<number>;
    dipPipUncouplingThreshold: TunableParameter<number>;
    dipPipLogitSlope: TunableParameter<number>;
    ckfBaseObservationNoise: TunableParameter<number>;
    ckfOcclusionGamma: TunableParameter<number>;
    selfOcclusionConfidenceFloor: TunableParameter<number>;
    maxFrameGapResetMs: TunableParameter<number>;
    defaultWebcamHfovDeg: TunableParameter<number>;
    referencePalmLengthMeters: TunableParameter<number>;
    referencePalmWidthMeters: TunableParameter<number>;
  };
  stage3ContactAndIntent: {
    sqiSafeIdleThreshold: TunableParameter<number>;
    sqiRecoveryHysteresis: TunableParameter<number>;
    minDepthMeters: TunableParameter<number>;
    maxDepthMeters: TunableParameter<number>;
    wakeAnchorBasePalmUnits: TunableParameter<number>;
    wakeAnchorTremorSlope: TunableParameter<number>;
    wakeAnchorMaxPalmUnits: TunableParameter<number>;
    holdPlateauFlexionStdMax: TunableParameter<number>;
    l4VetoReleaseHysteresisMs: TunableParameter<number>;
    sprtLeakRatePerSec: TunableParameter<number>;
    sprtCommitThreshold: TunableParameter<number>;
    sprtMaxAccumulator: TunableParameter<number>;
    sprtVetoPenalty: TunableParameter<number>;
    layerWeights: {
      w0ZoneDepth: number;
      w1Attention: number;
      w2WakeAnchor: number;
      w3HsmmHold: number;
    };
    titubationAdaptedLayerWeights: {
      w0ZoneDepth: number;
      w1Attention: number;
      w2WakeAnchor: number;
      w3HsmmHold: number;
    };
    normalAttentionConeDeg: TunableParameter<number>;
    titubationAttentionConeDeg: TunableParameter<number>;
    conformalAlpha: TunableParameter<number>;
    mondrianQuantiles: Record<string, number>;
    temperatureScale: TunableParameter<number>;
  };
  stage4TremorFilter: {
    cdfBasePoleAt30Fps: TunableParameter<number>;
    bmflcFreqMinHz: TunableParameter<number>;
    bmflcFreqMaxHz: TunableParameter<number>;
    bmflcFreqStepHz: TunableParameter<number>;
    bmflcMeasurementNoiseR: TunableParameter<number>;
    bmflcProcessNoiseQ0: TunableParameter<number>;
    dyskinesiaThreshold: TunableParameter<number>;
    shadowLearnerMinSteadySeconds: TunableParameter<number>;
    shadowLearnerDriftSigmaGate: TunableParameter<number>;
  };
  stage5Actuation: {
    airDialDefaultDetentPct: TunableParameter<number>;
    airDialDyskinesiaDetentPct: TunableParameter<number>;
    airDialHysteresisPct: TunableParameter<number>;
    airDialReleaseRollbackMs: TunableParameter<number>;
    undoWindowDurationMs: TunableParameter<number>;
    watchdogTimeoutMs: TunableParameter<number>;
    hmacReplayWindowMs: TunableParameter<number>;
    thermalAutoShutoffMinutes: TunableParameter<number>;
  };
}

export const STEADYGATE_V6_CONFIG: SteadyGateV6Config = {
  version: "6.0.0",
  regulatoryPositioning: {
    classification: "GENERAL_WELLNESS_ASSISTIVE_CONTROL",
    isMedicalDeviceSaMD: false,
    terminologyPolicy:
      "Use tremor-adaptive, hand-steadiness trends, and non-diagnostic assistive calibration. Never claim clinical diagnosis, treatment, or staging.",
  },
  features: {
    enableWebGpu: true,
    clinicalHeadGazeFallbackMode: false,
    researchTelemetryOptIn: false,
    disallowUnattendedThermalGestureOn: false,
  },
  frameBudgetMs: {
    totalCeilingMs: {
      value: 16.8,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Total 60fps synchronous frame budget including MediaPipe",
    },
    oursSyncCeilingMs: {
      value: 7.7,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "SteadyGate synchronous main-thread ceiling across Stages 1-5",
    },
    stage1OpticalMaxMs: {
      value: 2.0,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Stage 1 optical conditioning & flicker cancellation p95 ceiling",
    },
    stage2KinematicsMaxMs: {
      value: 1.3,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Stage 2 coupled DIP/PIP & joint-space CKF p95 ceiling",
    },
    stage3ContactIntentMaxMs: {
      value: 0.9,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Stage 3A/3B synchronous contact & SPRT conformal gate p95 ceiling",
    },
    stage4SignalFilterMaxMs: {
      value: 0.85,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Stage 4 CDF + 22-bin 2x2 block BMFLC-Kalman p95 ceiling",
    },
    stage5ActuationHudMaxMs: {
      value: 2.65,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Stage 5 Air-Dial, safety chord & ghost-hand HUD p95 ceiling",
    },
    maxAsyncWorkerStalenessMs: {
      value: 150,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Maximum acceptable age of cached asynchronous perception results",
    },
  },
  stage1Optical: {
    defaultMainsHz: {
      value: 50,
      unit: "Hz",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "hz",
      description: "Default utility mains frequency for Asia/Kolkata & EU",
    },
    shutterPeriod50HzMs: {
      value: 10.0,
      unit: "ms",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "seconds_or_ms",
      description: "100 Hz optical half-cycle period for 50 Hz AC mains",
    },
    shutterPeriod60HzMs: {
      value: 8.333,
      unit: "ms",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "seconds_or_ms",
      description: "120 Hz optical half-cycle period for 60 Hz AC mains",
    },
    shutterQuantizationToleranceRatio: {
      value: 0.01,
      unit: "ratio",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "unitless_ratio",
      description: "Max permissible UVC exposureTime step quantization error (1%)",
    },
    criticalDarkLumaFloor: {
      value: 0.08,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Luma floor below which manual shutter lock auto-relaxes to continuous",
    },
    lowLightLumaGate: {
      value: 0.22,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Scene mean luma threshold triggering luma-only conditioning",
    },
    glareContrastStdGate: {
      value: 0.32,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Scene contrast std threshold for harsh backlight glare conditioning",
    },
    glarePixelRatioGate: {
      value: 0.18,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Fraction of saturated pixels (>0.92 luma) indicating glare",
    },
    gammaMin: {
      value: 0.72,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Lower bound for median-anchored luma gamma lift",
    },
    gammaMax: {
      value: 1.38,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Upper bound for harsh glare gamma compression",
    },
    guidedFilterRadiusPx: {
      value: 4,
      unit: "px",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Box-aggregated guided filter spatial radius on 64x48 luma plane",
    },
    guidedFilterEps: {
      value: 0.02,
      unit: "luma_sq",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Edge-preserving regularizer epsilon on normalized [0,1] luma scale",
    },
    claheClipLimit: {
      value: 2.0,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Maximum contrast amplification factor for 8x8 luma CLAHE",
    },
    maxChromaDriftDeltaCbCr: {
      value: 1.5,
      unit: "cbcr_levels",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Maximum allowed U/V chrominance shift during luma-only conditioning",
    },
    flickerConfidenceGate: {
      value: 0.65,
      unit: "ratio",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "unitless_ratio",
      description: "Goertzel + spatial row-periodicity confidence threshold to engage row equalizer",
    },
    flickerGainMin: {
      value: 0.8,
      unit: "ratio",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "unitless_ratio",
      description: "Minimum per-row AC flicker equalization multiplier",
    },
    flickerGainMax: {
      value: 1.25,
      unit: "ratio",
      provenance: "physics:iec_mains_50_60hz",
      normalization: "unitless_ratio",
      description: "Maximum per-row AC flicker equalization multiplier",
    },
    relativeBlurSharpnessRatio: {
      value: 0.42,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Fraction of user p90 sharp-frame Laplacian variance below which motion blur is flagged",
    },
    blurKalmanNoiseMultiplier: {
      value: 10.0,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Stage 2 CKF observation covariance inflation factor during motion blur",
    },
  },
  stage2Kinematics: {
    defaultDipPipCouplingCoeff: {
      value: 0.68,
      unit: "ratio",
      provenance: "anatomy:kapandji_coupled_dip_pip",
      normalization: "unitless_ratio",
      description: "Population baseline flexor digitorum profundus DIP/PIP flexion coupling ratio",
    },
    dipPipUncouplingThreshold: {
      value: 0.16,
      unit: "ratio",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "unitless_ratio",
      description: "ROC-calibrated DIP/PIP uncoupling residual cutoff separating surface clamps from bare fists",
    },
    dipPipLogitSlope: {
      value: 14.5,
      unit: "unitless",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "unitless_ratio",
      description: "Logistic slope converting DIP/PIP uncoupling residual into log-likelihood ratio",
    },
    ckfBaseObservationNoise: {
      value: 3.5,
      unit: "deg_sq",
      provenance: "heuristic",
      normalization: "radians_or_deg",
      description: "Baseline joint angle observation variance R0 in degrees squared",
    },
    ckfOcclusionGamma: {
      value: 3.2,
      unit: "unitless",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Exponential observation noise scaling factor under low landmark visibility",
    },
    selfOcclusionConfidenceFloor: {
      value: 0.45,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Visibility confidence threshold below which coupled DIP pseudo-measurement is fused",
    },
    maxFrameGapResetMs: {
      value: 100,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Frame delta above which CKF velocity is damped and covariance inflated",
    },
    defaultWebcamHfovDeg: {
      value: 65,
      unit: "deg",
      provenance: "heuristic",
      normalization: "radians_or_deg",
      description: "Default horizontal field of view for monocular metric depth prior",
    },
    referencePalmLengthMeters: {
      value: 0.098,
      unit: "m",
      provenance: "anatomy:kapandji_coupled_dip_pip",
      normalization: "meters",
      description: "Adult osteological wrist-to-middle-MCP reference length in meters",
    },
    referencePalmWidthMeters: {
      value: 0.082,
      unit: "m",
      provenance: "anatomy:kapandji_coupled_dip_pip",
      normalization: "meters",
      description: "Adult osteological index-MCP-to-pinky-MCP reference width in meters",
    },
  },
  stage3ContactAndIntent: {
    sqiSafeIdleThreshold: {
      value: 0.38,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Signal Quality Index floor below which pipeline fails closed into SAFE_IDLE",
    },
    sqiRecoveryHysteresis: {
      value: 0.08,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Hysteresis margin required above sqiSafeIdleThreshold to exit SAFE_IDLE",
    },
    minDepthMeters: {
      value: 0.3,
      unit: "m",
      provenance: "heuristic",
      normalization: "meters",
      description: "Minimum soft operating depth envelope for Stage 3B L0",
    },
    maxDepthMeters: {
      value: 1.8,
      unit: "m",
      provenance: "heuristic",
      normalization: "meters",
      description: "Maximum soft operating depth envelope for Stage 3B L0",
    },
    wakeAnchorBasePalmUnits: {
      value: 0.038,
      unit: "palm_norm",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "palm_length_norm",
      description: "Base L2 stationary wake anchor radius in palm-length units",
    },
    wakeAnchorTremorSlope: {
      value: 1.8,
      unit: "unitless",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "unitless_ratio",
      description: "Scaling multiplier expanding L2 wake anchor radius per unit palm-normalized tremor RMS",
    },
    wakeAnchorMaxPalmUnits: {
      value: 0.55,
      unit: "palm_norm",
      provenance: "heuristic",
      normalization: "palm_length_norm",
      description: "Ceiling on L2 wake anchor radius in palm-length units",
    },
    holdPlateauFlexionStdMax: {
      value: 0.038,
      unit: "ratio",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "unitless_ratio",
      description: "Maximum intrinsic 5-finger flexion std during HSMM Hold plateau",
    },
    l4VetoReleaseHysteresisMs: {
      value: 150,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Hold-off time after object/self contact clears before L4 veto releases",
    },
    sprtLeakRatePerSec: {
      value: 0.85,
      unit: "1/s",
      provenance: "stat:wald_sprt_alpha_0.001_beta_0.02",
      normalization: "seconds_or_ms",
      description: "Exponential decay rate lambda_leak of Drift-Diffusion SPRT accumulator",
    },
    sprtCommitThreshold: {
      value: 0.62,
      unit: "nats",
      provenance: "stat:wald_sprt_alpha_0.001_beta_0.02",
      normalization: "unitless_ratio",
      description: "Wald upper evidence threshold E_commit to transition ENGAGED -> COMMITTED",
    },
    sprtMaxAccumulator: {
      value: 1.25,
      unit: "nats",
      provenance: "stat:wald_sprt_alpha_0.001_beta_0.02",
      normalization: "unitless_ratio",
      description: "Saturation ceiling E_max on SPRT evidence accumulator",
    },
    sprtVetoPenalty: {
      value: 2.5,
      unit: "nats",
      provenance: "stat:wald_sprt_alpha_0.001_beta_0.02",
      normalization: "unitless_ratio",
      description: "Instantaneous inhibition penalty kappa_veto applied when L4 contact veto is active",
    },
    layerWeights: {
      w0ZoneDepth: 0.22,
      w1Attention: 0.2,
      w2WakeAnchor: 0.28,
      w3HsmmHold: 0.3,
    },
    titubationAdaptedLayerWeights: {
      w0ZoneDepth: 0.3,
      w1Attention: 0.04,
      w2WakeAnchor: 0.28,
      w3HsmmHold: 0.38,
    },
    normalAttentionConeDeg: {
      value: 28,
      unit: "deg",
      provenance: "heuristic",
      normalization: "radians_or_deg",
      description: "Standard 3D head/gaze attention half-cone angle",
    },
    titubationAttentionConeDeg: {
      value: 55,
      unit: "deg",
      provenance: "heuristic",
      normalization: "radians_or_deg",
      description: "Widened attention half-cone angle under head titubation or cervical dyskinesia",
    },
    conformalAlpha: {
      value: 0.02,
      unit: "prob",
      provenance: "stat:mondrian_conformal_alpha_0.02",
      normalization: "unitless_ratio",
      description: "Target miscoverage rate alpha (98% target coverage) for Mondrian split conformal prediction",
    },
    mondrianQuantiles: {
      OPEN_PALM: 0.26,
      FIST: 0.26,
      PINCH: 0.24,
      THUMBS_UP: 0.28,
      THUMBS_DOWN: 0.28,
      VICTORY: 0.27,
      POINTING_UP: 0.27,
      CALL_ME: 0.27,
      THREE_FINGERS: 0.28,
      FOUR_FINGERS: 0.27,
      NON_GESTURE: 0.45,
    },
    temperatureScale: {
      value: 0.14,
      unit: "unitless",
      provenance: "fit:hagrid_real_benchmark/calibration_v6",
      normalization: "unitless_ratio",
      description: "Softmax temperature scaling parameter fit on calibration split",
    },
  },
  stage4TremorFilter: {
    cdfBasePoleAt30Fps: {
      value: 0.9,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Critical-Damped Filter pole parameter scaled by dt / 33.3ms for <= 30ms voluntary delay",
    },
    bmflcFreqMinHz: {
      value: 3.5,
      unit: "Hz",
      provenance: "heuristic",
      normalization: "hz",
      description: "Lower bound of 22-bin BMFLC-Kalman pathological tremor bank",
    },
    bmflcFreqMaxHz: {
      value: 14.0,
      unit: "Hz",
      provenance: "heuristic",
      normalization: "hz",
      description: "Upper bound of 22-bin BMFLC-Kalman pathological tremor bank",
    },
    bmflcFreqStepHz: {
      value: 0.5,
      unit: "Hz",
      provenance: "heuristic",
      normalization: "hz",
      description: "Frequency bin spacing of 22-bin block-decoupled BMFLC-Kalman bank",
    },
    bmflcMeasurementNoiseR: {
      value: 0.01,
      unit: "norm_sq",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Observation noise variance R of 2x2 block BMFLC-Kalman filter",
    },
    bmflcProcessNoiseQ0: {
      value: 0.18,
      unit: "norm_sq_per_s",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Continuous-time harmonic weight random-walk intensity q0",
    },
    dyskinesiaThreshold: {
      value: 0.55,
      unit: "ratio",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Dyskinesia likelihood threshold triggering L2 wake expansion and 10% Air-Dial detents",
    },
    shadowLearnerMinSteadySeconds: {
      value: 20.0,
      unit: "s",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Cumulative steady-hold duration required before ShadowBaselineLearner locks profile",
    },
    shadowLearnerDriftSigmaGate: {
      value: 2.5,
      unit: "sigma",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Spectral distribution shift threshold in standard deviations triggering RECALIBRATING state",
    },
  },
  stage5Actuation: {
    airDialDefaultDetentPct: {
      value: 5,
      unit: "pct",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Discrete ratchet step size (%) for Air-Dial clutch controller",
    },
    airDialDyskinesiaDetentPct: {
      value: 10,
      unit: "pct",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Coarse ratchet step size (%) when dyskinesiaLikelihood >= 0.55",
    },
    airDialHysteresisPct: {
      value: 1.5,
      unit: "pct",
      provenance: "heuristic",
      normalization: "unitless_ratio",
      description: "Deadband hysteresis (%) around each ratchet detent",
    },
    airDialReleaseRollbackMs: {
      value: 150,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Rollback lookback window on pinch release to discard finger-opening throw",
    },
    undoWindowDurationMs: {
      value: 5000,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Cancellable post-actuation rollback window duration in milliseconds",
    },
    watchdogTimeoutMs: {
      value: 2000,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Hardware relay heartbeat timeout before automatic safe de-energization",
    },
    hmacReplayWindowMs: {
      value: 30000,
      unit: "ms",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Maximum timestamp skew for HMAC-SHA256 signed LAN bridge requests",
    },
    thermalAutoShutoffMinutes: {
      value: 30,
      unit: "min",
      provenance: "heuristic",
      normalization: "seconds_or_ms",
      description: "Maximum continuous runtime for Tier 2 thermal loads before auto-shutoff",
    },
  },
};

export const ExtractedFrameTelemetrySchema = z.object({
  frameId: z.string().min(1),
  capturedAtIso: z.string().min(1),
  classification: z.object({
    resolvedGesture: z.string().min(1),
    confidence: z.number().min(0).max(1),
    marginOverRunnerUp: z.number().min(0).max(1),
    runnerUpGesture: z.string().min(1),
  }),
  biomechanics: z.object({
    fingerExtensions: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
    pipJointAnglesDeg: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
    mcpJointAnglesDeg: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    palmScaleNormalized: z.number().positive(),
    palmAspectRatio: z.number().positive(),
    thumbIndexCAperture: z.number().min(0),
    thumbToMcpDistances: z.object({
      d4_5: z.number().min(0),
      d4_9: z.number().min(0),
      d4_13: z.number().min(0),
      d4_17: z.number().min(0),
    }),
    normalHandSize: z.number().positive(),
    handDistanceEstimate: z.number().positive(),
    interFingerTipDistances: z.object({
      thumbIndex: z.number().min(0),
      indexMiddle: z.number().min(0),
      middleRing: z.number().min(0),
      ringPinky: z.number().min(0),
      thumbPinkySpan: z.number().min(0),
    }),
  }),
  objectHoldVerification: z.object({
    confirmedObjectInHand: z.boolean(),
    apertureOccupancyRatio: z.number().min(0).max(1),
    rejectionReason: z.string().min(1),
  }),
  tremorAndKinematics: z.object({
    dominantTremorHz: z.number().min(0),
    tremorAmplitudeRms: z.number().min(0),
    spectralConcentration: z.number().min(0).max(1),
    normalizedStability: z.number().min(0).max(1),
    lockStage: z.string().min(1),
  }),
  sceneOptics: z.object({
    luminanceMean: z.number().min(0).max(1),
    contrastStd: z.number().min(0),
    snrDb: z.number(),
    appliedGamma: z.number().positive(),
    claheGain: z.number().positive(),
  }),
  v6Diagnostics: z
    .object({
      dipPipUncouplingResidual: z.number().min(0),
      contactState100DOH: z.enum([
        "NO_CONTACT",
        "SELF_CONTACT",
        "OTHER_PERSON_CONTACT",
        "PORTABLE_OBJECT_CONTACT",
        "STATIONARY_OBJECT_CONTACT",
      ]),
      sprtLogLikelihoodRatio: z.number(),
      conformalSetSize: z.number().int().min(0),
      bmflcRmsResidual: z.number().min(0),
      laplacianBlurVariance: z.number().min(0),
      sqi: z.number().min(0).max(1),
    })
    .optional(),
});

export const AdminTrainingSampleSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  adminLabel: z.string().min(1),
  predictedBefore: z.string().min(1),
  fingerFlexion: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()]),
  palmLength: z.number().positive(),
  aspectRatio: z.number().positive(),
  cApertureRatio: z.number().min(0),
  d4_9Ratio: z.number().min(0),
  extractedTelemetry: ExtractedFrameTelemetrySchema,
});
