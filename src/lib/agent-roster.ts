import { AgentDefinition } from "./agent-types";

/**
 * Multi-Agent AI Roster
 * Each agent is a scope-specialized brain with a named well-trained model family.
 * Models are domain-specific expert systems (not general LLMs) tuned on SteadyGate
 * telemetry, clinical tremor literature, IoT bus patterns, and safety policy.
 */
export const AGENT_ROSTER: AgentDefinition[] = [
  {
    id: "agent_vision",
    name: "VisionGuard",
    role: "Computer Vision & Gesture Kinematics Auditor",
    scope: "VISION_GESTURE",
    model: {
      id: "SG-Vision-X3",
      name: "SteadyGate Vision Expert X3",
      family: "MediaPipe-Kinematic-Specialist",
      specialty: "21-landmark hand pose, occlusion, flexion ratios, gesture class margins",
      version: "3.2.1",
      trainingScope: [
        "MediaPipe Hands landmark noise models",
        "TIM-Tremor occlusion patterns",
        "Gesture confusion matrices (OPEN_PALM/VICTORY/FIST/POINTING/THUMBS)",
        "Low-light landmark jitter corpora",
      ],
      confidenceFloor: 0.78,
    },
    color: "#06b6d4",
    icon: "Eye",
    description:
      "Continuously audits gesture posterior, top-1/top-2 margin, finger flexion validity, and landmark visibility. Flags ambiguous class transitions and kinematic impossibilities.",
  },
  {
    id: "agent_signal",
    name: "TremorScope",
    role: "Signal Processing & Motion Signature Auditor",
    scope: "SIGNAL_TREMOR",
    model: {
      id: "SG-FFT-Neuro-2.1",
      name: "NeuroSpectral FFT Analyst 2.1",
      family: "Clinical-Tremor-DSP",
      specialty: "FFT peak detection, notch filter integrity, PMS drift, amplitude calibration",
      version: "2.1.0",
      trainingScope: [
        "Parkinsonian 4-6 Hz postural tremor spectra",
        "Essential tremor 6-9 Hz action spectra",
        "MediaPipe landmark noise vs true tremor discrimination",
        "Medication ON/OFF phase amplitude drift patterns",
      ],
      confidenceFloor: 0.82,
    },
    color: "#a855f7",
    icon: "Activity",
    description:
      "Validates personal motion signatures (f0, A0), notch bandwidth placement, residual energy after attenuation, and closed-loop calibration drift.",
  },
  {
    id: "agent_intent",
    name: "IntentCritic",
    role: "Intent Fusion & Dwell Policy Auditor",
    scope: "INTENT_GATE",
    model: {
      id: "SG-Gate-Fusion-4",
      name: "Intent Fusion Critic 4.0",
      family: "Multiplicative-Gate-Policy",
      specialty: "Fused intent score I, adaptive dwell T_req, false-reject/false-accept tradeoffs",
      version: "4.0.2",
      trainingScope: [
        "SteadyGate F3 fusion ablations",
        "Microsoft fixed-dwell failure modes",
        "Attention floor false-reject studies",
        "Uncertainty-adaptive dwell latency distributions",
      ],
      confidenceFloor: 0.8,
    },
    color: "#6366f1",
    icon: "Brain",
    description:
      "Deep-audits the fused intent equation, dwell formula T_base·(1+βA0)+k(1−I), reject-code distribution, and baseline-mode regressions.",
  },
  {
    id: "agent_iot",
    name: "RelayWatch",
    role: "IoT Bus, MQTT & ESP32 Actuation Auditor",
    scope: "IOT_MQTT",
    model: {
      id: "SG-MQTT-Edge-1.5",
      name: "Edge MQTT Integrity Monitor 1.5",
      family: "ESP32-Relay-Telemetry",
      specialty: "Absolute-state SET consistency, GPIO mapping, wattage/RPM/CFM physics, ACK latency",
      version: "1.5.3",
      trainingScope: [
        "MQTT QoS-1 ACK failure patterns",
        "Fan RPM/CFM physics invariants",
        "AC compressor load curves",
        "Idempotent SET vs TOGGLE hazard cases",
      ],
      confidenceFloor: 0.85,
    },
    color: "#10b981",
    icon: "Radio",
    description:
      "Validates physical IoT state coherence: fan speed↔RPM↔CFM, AC temp↔wattage, lamp brightness↔lux, deadbolt latch state, and MQTT topic/GPIO integrity.",
  },
  {
    id: "agent_safety",
    name: "HazardSentinel",
    role: "R2 Safety & Risk-Tier Policy Auditor",
    scope: "SAFETY_RISK",
    model: {
      id: "SG-Safety-R2-Pro",
      name: "R2 Hazard Policy Sentinel Pro",
      family: "Functional-Safety-ASIL",
      specialty: "Two-gesture handshake enforcement, R2 false-actuation prevention, fire/scald/perimeter hazards",
      version: "1.8.0",
      trainingScope: [
        "IEC 61508 functional safety patterns",
        "Radiant heater coil ignition scenarios",
        "Geyser scald temperature thresholds",
        "Deadbolt perimeter breach case studies",
      ],
      confidenceFloor: 0.9,
    },
    color: "#f43f5e",
    icon: "ShieldAlert",
    description:
      "Enforces R2 two-gesture handshake invariants. Flags any path that could energize a heater, geyser, or unlock a deadbolt without secondary confirmation.",
  },
  {
    id: "agent_personalize",
    name: "AdaptLearner",
    role: "Personalization & Prototype Drift Auditor",
    scope: "PERSONALIZATION",
    model: {
      id: "SG-Adapt-Proto-2",
      name: "Adaptive Prototype Learner 2.0",
      family: "Online-Prototype-Boost",
      specialty: "Per-user gesture prototype boosts, finger flexibility, weak-supervision nudges",
      version: "2.0.1",
      trainingScope: [
        "Online prototype confidence boost dynamics",
        "Finger flexibility motor-impairment models",
        "Weak-supervision +4% amplitude nudge safety bounds",
        "Medication-phase circadian recalibration",
      ],
      confidenceFloor: 0.77,
    },
    color: "#f59e0b",
    icon: "Wand2",
    description:
      "Monitors personalized prototype JSON, over-boost runaway, under-calibrated tremor users, and stale enrolment timestamps.",
  },
  {
    id: "agent_health",
    name: "SysPulse",
    role: "System Health & Runtime Integrity Auditor",
    scope: "SYSTEM_HEALTH",
    model: {
      id: "SG-SysHealth-1.0",
      name: "System Pulse Monitor 1.0",
      family: "Fullstack-Runtime-SRE",
      specialty: "API health, DB coherence, seed integrity, orphaned logs, power budget anomalies",
      version: "1.0.4",
      trainingScope: [
        "Next.js route health patterns",
        "PostgreSQL/Drizzle integrity checks",
        "Actuation log orphan detection",
        "Household power budget anomaly detection",
      ],
      confidenceFloor: 0.75,
    },
    color: "#94a3b8",
    icon: "HeartPulse",
    description:
      "Full-stack SRE agent: DB row counts, orphaned foreign keys, impossible power totals, stale calibration, and API surface completeness.",
  },
  {
    id: "agent_frontend",
    name: "FrontendRuntimeGuard",
    role: "Browser Vision-Pipeline & Client Runtime Auditor",
    scope: "FRONTEND_RUNTIME",
    model: {
      id: "SG-FE-Runtime-2.0",
      name: "Client Runtime Guard 2.0",
      family: "Browser-Telemetry-SRE",
      specialty: "MediaPipe load chain, WASM/GPU delegate, fps, detection rate, JS exceptions, synthetic-vs-real mode",
      version: "2.0.0",
      trainingScope: [
        "MediaPipe tasks-vision loader failure signatures (WASM 404, WebGL context loss, model 403)",
        "requestAnimationFrame starvation & fps collapse patterns",
        "getUserMedia permission/NotFound/Overconstrained taxonomies",
        "Synthetic-fallback masking real-recognition outages",
      ],
      confidenceFloor: 0.85,
    },
    color: "#22d3ee",
    icon: "Eye",
    description:
      "Reads live browser telemetry. Detects when recognition is silently synthetic, when the model failed to load, GPU→CPU fallbacks, fps collapse, and uncaught client errors — with the exact loader stage that failed.",
  },
  {
    id: "agent_scene",
    name: "SceneRobustness",
    role: "Lighting, Background & Detection-Quality Auditor",
    scope: "SCENE_ROBUSTNESS",
    model: {
      id: "SG-Scene-Adapt-1.3",
      name: "Scene Adaptation Analyst 1.3",
      family: "Illumination-Clutter-Robustness",
      specialty: "Luminance/contrast/clutter → detection-rate causality, gain remediation, hand-scale coaching",
      version: "1.3.0",
      trainingScope: [
        "Low-light landmark dropout curves (detect-rate vs mean luminance)",
        "Cluttered background edge-density vs false hand proposals",
        "Backlight / overexposure saturation failure modes",
        "Hand-scale (distance) vs landmark confidence relationships",
      ],
      confidenceFloor: 0.82,
    },
    color: "#f59e0b",
    icon: "Activity",
    description:
      "When the hand is not detected, explains why from measured scene statistics — too dark, low contrast, cluttered, too far — reports which auto-gains were applied and what to change physically.",
  },
  {
    id: "agent_intentflow",
    name: "IntentContinuity",
    role: "User Intent Stream & Command-Desire Auditor",
    scope: "INTENT_CONTINUITY",
    model: {
      id: "SG-IntentFlow-3.0",
      name: "Intent Continuity Analyst 3.0",
      family: "Temporal-Intent-Reasoner",
      specialty: "Presence streaks, transit vs hold, vote stability, abandoned dwells, gesture→device coherence",
      version: "3.0.0",
      trainingScope: [
        "Hand-transit vs deliberate-hold velocity distributions (tremor-normalised)",
        "Gesture vote agreement vs false-positive actuation studies",
        "Dwell abandonment and retry behaviour",
        "Gesture semantics vs selected-appliance mismatch",
      ],
      confidenceFloor: 0.8,
    },
    color: "#8b5cf6",
    icon: "Brain",
    description:
      "Continuously judges whether the person actually wants to change an appliance: sustained presence, stable vote, no transit, in-zone, coherent with the selected device — and flags near-misses or accidental triggers.",
  },
  {
    id: "agent_api",
    name: "APIGuard",
    role: "Backend Route, Latency & Contract Auditor",
    scope: "API_BACKEND",
    model: {
      id: "SG-API-Probe-1.1",
      name: "Backend Contract Prober 1.1",
      family: "HTTP-Contract-SRE",
      specialty: "Live probes of every route, status/latency/contract validation, DB connectivity, R2 guard behaviour",
      version: "1.1.0",
      trainingScope: [
        "Next.js route handler failure signatures",
        "Drizzle/Postgres connectivity and timeout patterns",
        "Response-shape contract drift",
        "Authorization guard regression tests (R2 403)",
      ],
      confidenceFloor: 0.9,
    },
    color: "#10b981",
    icon: "Radio",
    description:
      "Actively calls /api/health, /users, /appliances, /logs, /telemetry, /agents during each council run, validates status codes, latency and JSON contracts, and verifies the R2 guard still returns 403.",
  },
  {
    id: "agent_orchestrator",
    name: "ChiefDebugger",
    role: "Multi-Agent Orchestrator & Root-Cause Correlator",
    scope: "ORCHESTRATOR",
    model: {
      id: "SG-Chief-Debug-5",
      name: "Chief Debugger Correlator 5.0",
      family: "Cross-Agent-Causal-Graph",
      specialty: "Cross-scope root-cause correlation, severity escalation, admin-ready fix packages",
      version: "5.0.0",
      trainingScope: [
        "Causal graphs across vision→signal→intent→iot→safety",
        "Severity escalation policy",
        "Admin fix-package synthesis",
        "Duplicate finding suppression",
      ],
      confidenceFloor: 0.88,
    },
    color: "#eab308",
    icon: "Bot",
    description:
      "Meta-agent that fuses all specialist findings into correlated root causes, suppresses duplicates, escalates severity, and produces exact admin debugging solutions.",
  },
];

export function getAgentById(id: string): AgentDefinition | undefined {
  return AGENT_ROSTER.find((a) => a.id === id);
}
