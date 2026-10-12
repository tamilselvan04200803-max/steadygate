import {
  AgentAnalysisResult,
  AgentFinding,
  AgentTraceStep,
  AnalysisSnapshot,
  AgentSeverity,
  TelemetrySample,
  ApiProbe,
} from "./agent-types";
import { AGENT_ROSTER } from "./agent-roster";
import {
  runFrontendRuntimeGuard,
  runSceneRobustness,
  runIntentContinuity,
  runApiGuard,
} from "./agent-brain-runtime";

function uid(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function severityRank(s: AgentSeverity): number {
  switch (s) {
    case "CRITICAL":
      return 5;
    case "HIGH":
      return 4;
    case "MEDIUM":
      return 3;
    case "LOW":
      return 2;
    default:
      return 1;
  }
}

type FindingDraft = Omit<
  AgentFinding,
  "id" | "runId" | "createdAt" | "status" | "resolvedAt"
>;

function finding(
  agentId: string,
  partial: {
    severity: AgentSeverity;
    category: string;
    title: string;
    symptom: string;
    rootCause: string;
    evidence: Record<string, unknown>;
    fixSteps: string[];
    codeHints?: string[];
    affectedModules?: string[];
    confidence?: number;
  }
): FindingDraft {
  const agent = AGENT_ROSTER.find((a) => a.id === agentId)!;
  return {
    agentId: agent.id,
    agentName: agent.name,
    modelId: agent.model.id,
    severity: partial.severity,
    category: partial.category,
    title: partial.title,
    symptom: partial.symptom,
    rootCause: partial.rootCause,
    evidence: JSON.stringify(partial.evidence),
    fixSteps: JSON.stringify(partial.fixSteps),
    codeHints: JSON.stringify(partial.codeHints || []),
    affectedModules: JSON.stringify(partial.affectedModules || []),
    confidence: partial.confidence ?? agent.model.confidenceFloor + 0.08,
  };
}

function trace(
  agentId: string,
  phase: AgentTraceStep["phase"],
  message: string,
  durationMs: number
): AgentTraceStep {
  const agent = AGENT_ROSTER.find((a) => a.id === agentId)!;
  return {
    agentId: agent.id,
    agentName: agent.name,
    modelId: agent.model.id,
    phase,
    message,
    ts: nowIso(),
    durationMs,
  };
}

/** ---------- Specialist Agents ---------- */

function runVisionGuard(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_vision", "OBSERVE", "Ingesting recent actuation gesture posteriors & margins", 12));
  const logs = snap.recentLogs;
  const lowMargin = logs.filter((l) => Number(l.margin) < 0.15);
  const lowPosterior = logs.filter((l) => Number(l.posterior) < 0.7);
  const ambiguousRejects = logs.filter((l) => l.rejectCode === "AMBIGUOUS_CLASS");

  traces.push(
    trace(
      "agent_vision",
      "REASON",
      `Scanned ${logs.length} logs → low-margin=${lowMargin.length}, low-posterior=${lowPosterior.length}, ambiguous-rejects=${ambiguousRejects.length}`,
      28
    )
  );

  if (lowMargin.length >= 2) {
    findings.push(
      finding("agent_vision", {
        severity: "HIGH",
        category: "GESTURE_AMBIGUITY",
        title: "Narrow classification margin between top-1 and top-2 gestures",
        symptom: `${lowMargin.length} recent actuations had margin < 0.15, risking VICTORY↔POINTING or OPEN_PALM↔FIST confusions.`,
        rootCause:
          "Gesture kinematic decision boundaries are too close for the active user's finger-flexibility profile. Top-1/top-2 class separation collapses when middle+ring extension ratios are mid-range (0.4–0.6), typical of motor-impaired users mid-transition.",
        evidence: {
          lowMarginCount: lowMargin.length,
          sampleMargins: lowMargin.slice(0, 5).map((l) => ({
            id: l.id,
            gesture: l.gesture,
            margin: l.margin,
            posterior: l.posterior,
          })),
          threshold: 0.15,
        },
        fixSteps: [
          "Open Admin → Agents → VisionGuard finding and click 'Apply Suggested Fix'.",
          "Raise IntentGate margin floor from 0.12 → 0.18 in src/lib/steady-gate.ts (AMBIGUOUS_CLASS check).",
          "Run Personalize on VICTORY and POINTING_UP for the affected user to boost prototype separation.",
          "In hand-gesture-engine.ts, increase VICTORY ring/pinky curl weight from 0.4 → 0.55 to sharpen discrimination.",
          "Re-run continuous agent scan to verify margin distribution shifts above 0.20.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts → if (margin < 0.12 || input.posterior < 0.65)",
          "src/lib/hand-gesture-engine.ts → scores.VICTORY = victoryOpen * 0.6 + victoryCurled * 0.4",
          "POST /api/personalize { gestureToCalibrate: 'VICTORY' }",
        ],
        affectedModules: ["hand-gesture-engine", "steady-gate", "LiveCameraStream"],
        confidence: 0.91,
      })
    );
  }

  if (ambiguousRejects.length >= 1) {
    findings.push(
      finding("agent_vision", {
        severity: "MEDIUM",
        category: "GESTURE_REJECT_SPIKE",
        title: "AMBIGUOUS_CLASS reject-code spike detected",
        symptom: `${ambiguousRejects.length} AMBIGUOUS_CLASS refusals in recent window.`,
        rootCause:
          "Classifier posterior or margin fell below SteadyGate hard floors during gesture transitions. Often caused by incomplete finger extension mid-dwell or synthetic tremor pushing landmarks across decision boundaries.",
        evidence: {
          count: ambiguousRejects.length,
          gestures: ambiguousRejects.map((l) => l.gesture),
        },
        fixSteps: [
          "Inspect finger flexion meters in Live Controller during the failing gesture.",
          "If middle/ring hover near 0.5, coach user to fully extend or fully curl.",
          "Apply AdaptLearner personalization boost for that gesture.",
          "Optionally soften posterior floor 0.65 → 0.60 only for enrolled tremor users (keep 0.65 for steady).",
        ],
        codeHints: [
          "src/lib/steady-gate.ts AMBIGUOUS_CLASS branch",
          "src/components/LiveCameraStream.tsx finger flexion HUD",
        ],
        affectedModules: ["steady-gate", "hand-gesture-engine"],
        confidence: 0.86,
      })
    );
  }

  // Check gesture→appliance routing coherence
  const victoryOnNonFan = logs.filter(
    (l) =>
      String(l.gesture).includes("VICTORY") &&
      l.status === "ACTUATED" &&
      !String(l.applianceId).includes("fan")
  );
  if (victoryOnNonFan.length > 0) {
    findings.push(
      finding("agent_vision", {
        severity: "MEDIUM",
        category: "GESTURE_ROUTING",
        title: "VICTORY gesture actuated non-fan appliance",
        symptom: `VICTORY (fan-speed cycle semantics) was applied to non-fan targets ${victoryOnNonFan.length} time(s).`,
        rootCause:
          "Auto-routing in page.tsx only switches target when VICTORY is recognized IF fan exists, but manual target selection can override. Actuate route still accepts VICTORY on any appliance and falls through to default power toggle.",
        evidence: {
          events: victoryOnNonFan.slice(0, 3).map((l) => ({
            applianceId: l.applianceId,
            applianceName: l.applianceName,
          })),
        },
        fixSteps: [
          "In src/app/api/actuate/route.ts, when gesture===VICTORY and appliance is not fan/climate, either hard-reroute to fan_table or reject with OUT_OF_ZONE.",
          "Surface a VisionGuard toast: 'VICTORY is bound to Fan Speed — retargeting Study Turbo Fan'.",
          "Add unit test: VICTORY on lamp_desk must not toggle lamp power.",
        ],
        codeHints: [
          "src/app/api/actuate/route.ts gesture === 'VICTORY' branch",
          "src/app/page.tsx handleGestureRecognized auto-routing",
        ],
        affectedModules: ["actuate API", "page.tsx"],
        confidence: 0.88,
      })
    );
  }

  traces.push(
    trace(
      "agent_vision",
      "DIAGNOSE",
      `VisionGuard produced ${findings.length} finding(s) in ${Date.now() - t0}ms`,
      Date.now() - t0
    )
  );
  if (findings.length > 0) {
    traces.push(
      trace("agent_vision", "PRESCRIBE", "Emitted exact code-level fix steps for admin console", 8)
    );
  }

  return { findings, traces };
}

function runTremorScope(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_signal", "OBSERVE", "Loading user PMS profiles & stability_norm telemetry", 10));

  const users = snap.users;
  const logs = snap.recentLogs;

  for (const u of users) {
    const f0 = Number(u.f0Hz);
    const amp = Number(u.amplitudeRms);
    const condition = String(u.condition || "");

    // Pathological f0 sanity
    if (condition.toLowerCase().includes("parkinson") && (f0 < 3.5 || f0 > 7.5)) {
      findings.push(
        finding("agent_signal", {
          severity: "HIGH",
          category: "PMS_FREQUENCY_DRIFT",
          title: `Parkinsonian user ${u.name} has out-of-band f₀=${f0} Hz`,
          symptom: `Enrolled dominant frequency ${f0} Hz is outside clinical PD postural band (4–6 Hz typical, 3.5–7.5 Hz acceptable).`,
          rootCause:
            "10-s enrolment FFT likely locked onto a harmonic, reach-drift residual, or MediaPipe landmark noise peak instead of true tremor fundamental. Notch filter is therefore attenuating the wrong band, leaving residual tremor in S_norm.",
          evidence: { userId: u.id, f0Hz: f0, amplitudeRms: amp, condition },
          fixSteps: [
            `Re-run 10-s Enrolment for user ${u.name} with hand in true postural hold (no reach).`,
            "In motion_signature / signal-processing, constrain peak search to 4–7 Hz for PD-tagged users.",
            "Validate f₀ against expected band; if peak magnitude < 0.01, fall back to condition prior (PD→5.2 Hz).",
            "After re-enrol, confirm S_norm > 0.75 while hand exhibits visible tremor.",
          ],
          codeHints: [
            "src/lib/signal-processing.ts extractMotionSignature minFreqHz/maxFreqHz",
            "src/app/api/enrol/route.ts presetCondition === 'parkinson'",
          ],
          affectedModules: ["signal-processing", "enrol API", "users"],
          confidence: 0.9,
        })
      );
    }

    if (condition.toLowerCase().includes("essential") && (f0 < 5.0 || f0 > 10.0)) {
      findings.push(
        finding("agent_signal", {
          severity: "HIGH",
          category: "PMS_FREQUENCY_DRIFT",
          title: `Essential Tremor user ${u.name} f₀=${f0} Hz outside 6–9 Hz band`,
          symptom: `ET profile frequency ${f0} Hz is clinically inconsistent.`,
          rootCause: "Enrolment spectral peak mis-identified; notch will fail to quench action tremor.",
          evidence: { userId: u.id, f0Hz: f0, amplitudeRms: amp },
          fixSteps: [
            "Re-enrol with kinetic (action) posture — ET is action/postural, not pure rest.",
            "Widen ET search band to 5.5–10 Hz in extractMotionSignature call path for ET presets.",
            "Confirm band RMS A₀ after re-enrol is ≥ 0.04 for symptomatic ET.",
          ],
          codeHints: ["src/lib/signal-processing.ts", "src/app/api/enrol/route.ts"],
          affectedModules: ["signal-processing", "enrol API"],
          confidence: 0.87,
        })
      );
    }

    // Amplitude vs condition
    if (
      (condition.toLowerCase().includes("parkinson") ||
        condition.toLowerCase().includes("essential") ||
        condition.toLowerCase().includes("tremor")) &&
      amp < 0.015
    ) {
      findings.push(
        finding("agent_signal", {
          severity: "MEDIUM",
          category: "PMS_AMPLITUDE_UNDERFIT",
          title: `Tremor user ${u.name} has near-zero A₀=${amp} — profile underfit`,
          symptom: "Baseline amplitude too low for a clinical tremor user; S_norm will over-penalize normal residual.",
          rootCause:
            "Either enrolment captured a medicated ON-phase quiet period, or landmark trajectory was over-smoothed before FFT, collapsing band energy.",
          evidence: { userId: u.id, amplitudeRms: amp, medicationPhase: u.medicationPhase },
          fixSteps: [
            "Check medication phase — if ON Phase, schedule re-enrol during Wearing OFF.",
            "Reduce any pre-FFT smoothing; use raw wrist Y with only linear detrend.",
            "Floor A₀ at 0.025 for clinically tagged tremor users to keep dwell scaling meaningful.",
          ],
          codeHints: [
            "src/db/schema.ts users.amplitudeRms",
            "src/lib/steady-gate.ts calculateRequiredDwellMs tremorDwellScale",
          ],
          affectedModules: ["users", "signal-processing", "steady-gate"],
          confidence: 0.84,
        })
      );
    }
  }

  // Stability norm vs raw divergence (tremor compensation working?)
  const tremorRejects = logs.filter((l) => l.rejectCode === "TREMOR_EXCEEDS_PROFILE");
  const rawFailNormPass = logs.filter(
    (l) => Number(l.stabilityRaw) < 0.55 && Number(l.stabilityNorm) >= 0.75
  );

  traces.push(
    trace(
      "agent_signal",
      "REASON",
      `TREMOR_EXCEEDS rejects=${tremorRejects.length}; raw-fail/norm-pass success cases=${rawFailNormPass.length}`,
      22
    )
  );

  if (tremorRejects.length >= 2) {
    findings.push(
      finding("agent_signal", {
        severity: "HIGH",
        category: "NOTCH_UNDER_ATTENUATION",
        title: "Repeated TREMOR_EXCEEDS_PROFILE refusals — notch not quenching user tremor",
        symptom: `${tremorRejects.length} refusals with code TREMOR_EXCEEDS_PROFILE. Users cannot complete dwell.`,
        rootCause:
          "Either f₀ is misaligned (notch misses true tremor band), notch bandwidth too narrow (±1 Hz), or residual non-tremor motion (reach drift) dominates after attenuation so S_norm stays < 0.50.",
        evidence: {
          rejectCount: tremorRejects.length,
          samples: tremorRejects.slice(0, 4).map((l) => ({
            user: l.userName,
            stabilityRaw: l.stabilityRaw,
            stabilityNorm: l.stabilityNorm,
            intent: l.intentScore,
          })),
        },
        fixSteps: [
          "For affected users, widen notchBandwidthHz from 2.0 → 3.0 (f₀ ± 1.5 Hz).",
          "Drop S_norm reject floor from 0.50 → 0.42 for users with A₀ > 0.05 (severe tremor).",
          "Verify wrist landmark is used for f₀ (not noisy fingertips) — already preferred in F1 design.",
          "Trigger closed-loop +4% A₀ nudge by coaching a successful re-attempt within 3.5 s.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts stabilityNorm < 0.50 → TREMOR_EXCEEDS_PROFILE",
          "src/lib/signal-processing.ts calculateNormalizedStability halfWidth",
          "users.notchBandwidthHz column",
        ],
        affectedModules: ["steady-gate", "signal-processing", "users"],
        confidence: 0.92,
      })
    );
  }

  if (rawFailNormPass.length >= 3) {
    traces.push(
      trace(
        "agent_signal",
        "DIAGNOSE",
        "F2 signature-normalization is working: raw fails but S_norm passes on multiple samples (accessibility win)",
        6
      )
    );
    findings.push(
      finding("agent_signal", {
        severity: "INFO",
        category: "F2_WORKING_AS_DESIGNED",
        title: "Signature-normalized stability correctly rescuing tremor users",
        symptom: `${rawFailNormPass.length} events where S_raw < 0.55 but S_norm ≥ 0.75 — prior-art baselines would have rejected these.`,
        rootCause:
          "Not a defect. Confirms F2 notch+normalize path is delivering the accessibility technical effect claimed in the patent.",
        evidence: { count: rawFailNormPass.length },
        fixSteps: [
          "No fix required. Log this as positive inventive-step evidence for evaluation §5.",
          "Include these samples in the tremor-amplitude sweep benchmark narrative.",
        ],
        codeHints: ["src/lib/signal-processing.ts calculateNormalizedStability"],
        affectedModules: ["signal-processing"],
        confidence: 0.95,
      })
    );
  }

  // Stale calibration
  for (const u of users) {
    const last = u.lastCalibratedAt ? new Date(String(u.lastCalibratedAt)).getTime() : 0;
    const ageHours = last ? (Date.now() - last) / 3600000 : 999;
    if (ageHours > 72 && String(u.condition).toLowerCase().includes("tremor")) {
      findings.push(
        finding("agent_signal", {
          severity: "LOW",
          category: "STALE_CALIBRATION",
          title: `PMS for ${u.name} not recalibrated in ${Math.round(ageHours)}h`,
          symptom: "Medication cycles and circadian drift can shift A₀ within 24–72 h.",
          rootCause: "No automatic re-enrolment schedule; lastCalibratedAt is stale relative to clinical best practice.",
          evidence: { userId: u.id, lastCalibratedAt: u.lastCalibratedAt, ageHours: Math.round(ageHours) },
          fixSteps: [
            "Prompt user for 10-s re-enrolment at next login if age > 48 h.",
            "Optionally auto-nudge A₀ from weak-supervision history without full re-enrol.",
          ],
          codeHints: ["users.lastCalibratedAt", "EnrolmentModal"],
          affectedModules: ["users", "EnrolmentModal"],
          confidence: 0.8,
        })
      );
    }
  }

  traces.push(
    trace("agent_signal", "PRESCRIBE", `TremorScope completed with ${findings.length} findings`, Date.now() - t0)
  );
  return { findings, traces };
}

function runIntentCritic(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_intent", "OBSERVE", "Analyzing intent fusion scores, dwell completion, reject taxonomy", 11));

  const logs = snap.recentLogs;
  const sys = snap.system;

  if (logs.length >= 5 && sys.rejectRate > 0.55) {
    findings.push(
      finding("agent_intent", {
        severity: "HIGH",
        category: "FALSE_REJECT_RATE",
        title: `Elevated false-reject rate ${(sys.rejectRate * 100).toFixed(0)}% over recent window`,
        symptom: `${sys.rejectedCount}/${logs.length} actuations rejected. Users will perceive the system as unusable.`,
        rootCause:
          "Compounding hard floors (attention, margin, S_norm, scene) plus long adaptive dwell for high-A₀ users causes timeout rejects (GESTURE_UNSTABLE) before T_req is reached. Multiplicative fusion also drives I down when any single factor dips.",
        evidence: {
          rejectRate: sys.rejectRate,
          avgIntentScore: sys.avgIntentScore,
          avgStabilityNorm: sys.avgStabilityNorm,
          avgAttention: sys.avgAttention,
          rejectCodes: logs
            .filter((l) => l.status === "REJECTED")
            .reduce((acc: Record<string, number>, l) => {
              const k = String(l.rejectCode);
              acc[k] = (acc[k] || 0) + 1;
              return acc;
            }, {}),
        },
        fixSteps: [
          "Plot reject-code histogram in Admin console (already in evidence).",
          "If GESTURE_UNSTABLE dominates: reduce T_base(R1) 1400→1100 ms and k(R1) 900→700.",
          "If LOW_ATTENTION dominates: lower user.attentionFloor by 0.05 for tremor users.",
          "If multiplicative I is harsh, switch fusion to geometric mean with floor: I = max(0.15, Π components^(w)).",
          "Enable dwell progress coaching toast at 50% and 80% so users hold longer.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts calculateRequiredDwellMs baseTable/kTable",
          "src/lib/steady-gate.ts calculateIntentScore",
          "users.attentionFloor",
        ],
        affectedModules: ["steady-gate", "DwellRingController"],
        confidence: 0.89,
      })
    );
  }

  // Baseline mode misuse
  const baselineNonSG = logs.filter((l) => l.baselineMode && l.baselineMode !== "STEADYGATE");
  if (baselineNonSG.length > 0) {
    const b0rejects = baselineNonSG.filter(
      (l) => l.baselineMode === "B0_RAW" && l.status === "REJECTED"
    );
    findings.push(
      finding("agent_intent", {
        severity: baselineNonSG.length >= 3 ? "MEDIUM" : "LOW",
        category: "BASELINE_MODE_ACTIVE",
        title: "Prior-art baseline mode engaged during live session",
        symptom: `${baselineNonSG.length} events ran under B0/B1/B2. Tremor users will systematically fail.`,
        rootCause:
          "Admin or user left baseline comparison mode enabled. B0 uses raw stability ≥ 0.70 and fixed 0.85 confidence — known to collapse for A₀ > 0.03.",
        evidence: {
          modes: baselineNonSG.map((l) => l.baselineMode),
          b0Rejects: b0rejects.length,
        },
        fixSteps: [
          "Switch header mode selector back to 'SteadyGate (Ours)'.",
          "If intentional A/B test, isolate baseline runs from production audit metrics.",
          "Add guard: auto-revert to STEADYGATE after 5 minutes outside lab tab.",
        ],
        codeHints: ["src/components/Header.tsx baselineMode", "src/lib/steady-gate.ts B0_RAW branch"],
        affectedModules: ["Header", "steady-gate"],
        confidence: 0.93,
      })
    );
  }

  // Attention floor violations
  const lowAtt = logs.filter((l) => l.rejectCode === "LOW_ATTENTION");
  if (lowAtt.length >= 2) {
    findings.push(
      finding("agent_intent", {
        severity: "MEDIUM",
        category: "ATTENTION_FLOOR",
        title: "Repeated LOW_ATTENTION refusals",
        symptom: `${lowAtt.length} commands blocked because head-pose attention < user floor.`,
        rootCause:
          "FaceMesh gaze vector not directed at appliance ROI, OR attention slider/sim left low, OR attentionFloor set too aggressively for the user.",
        evidence: {
          samples: lowAtt.slice(0, 3).map((l) => ({
            attention: l.attention,
            user: l.userName,
          })),
        },
        fixSteps: [
          "In Live Controller, raise Attention slider above the user's floor (shown in Intent radar).",
          "For motor-impaired users who cannot hold head still, lower attentionFloor 0.60→0.50.",
          "Weight attention exponent in fusion from 0.9 → 0.7 to reduce over-penalization.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts attention < user.attentionFloor",
          "calculateIntentScore Math.pow(attention, 0.9)",
        ],
        affectedModules: ["steady-gate", "IntentFusionRadar", "LiveCameraStream"],
        confidence: 0.87,
      })
    );
  }

  // Dwell mismatch: completed almost enough
  const nearMiss = logs.filter(
    (l) =>
      l.status === "REJECTED" &&
      l.rejectCode === "GESTURE_UNSTABLE" &&
      Number(l.dwellTimeMs) / Math.max(1, Number(l.dwellRequiredMs)) >= 0.85
  );
  if (nearMiss.length >= 2) {
    findings.push(
      finding("agent_intent", {
        severity: "MEDIUM",
        category: "DWELL_NEAR_MISS",
        title: "Users abandoning dwell at ≥85% progress — T_req slightly too long",
        symptom: `${nearMiss.length} near-miss timeouts. Motor fatigue likely at end of hold.`,
        rootCause:
          "Adaptive dwell scaling by A₀ pushes T_req beyond comfortable hold duration for severe tremor, even though S_norm is passing.",
        evidence: {
          samples: nearMiss.slice(0, 4).map((l) => ({
            dwellTimeMs: l.dwellTimeMs,
            dwellRequiredMs: l.dwellRequiredMs,
            pct: Math.round((Number(l.dwellTimeMs) / Number(l.dwellRequiredMs)) * 100),
            risk: l.riskTier,
          })),
        },
        fixSteps: [
          "Clamp tremorDwellScale max from 2.5 → 1.8 in calculateRequiredDwellMs.",
          "Add 'grace commit' : if progress ≥ 90% and I ≥ 0.65 and S_norm ≥ 0.7, accept actuation.",
          "Show remaining ms countdown in DwellRing to reduce abandonment.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts tremorDwellScale = 1.0 + Math.min(2.5, amplitudeRms * 12.0)",
          "src/components/DwellRingController.tsx",
        ],
        affectedModules: ["steady-gate", "DwellRingController"],
        confidence: 0.9,
      })
    );
  }

  traces.push(
    trace("agent_intent", "DIAGNOSE", `IntentCritic findings=${findings.length}`, Date.now() - t0)
  );
  return { findings, traces };
}

function runRelayWatch(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_iot", "OBSERVE", "Validating appliance physics invariants & MQTT topology", 9));

  for (const a of snap.appliances) {
    const id = String(a.id);
    const power = String(a.powerState);
    const fanSpeed = Number(a.fanSpeed || 0);
    const airRpm = Number(a.airRpm || 0);
    const airflowCfm = Number(a.airflowCfm || 0);
    const wattage = Number(a.activeWattage || 0);
    const temp = Number(a.temperature || 0);
    const brightness = Number(a.brightness || 0);

    // Fan physics
    if (id.includes("fan")) {
      if (power === "ON" && fanSpeed === 0) {
        findings.push(
          finding("agent_iot", {
            severity: "HIGH",
            category: "IOT_STATE_INCOHERENCE",
            title: `Fan ${a.name} is ON but fanSpeed=0`,
            symptom: "Power state ON with zero speed — UI and MQTT payload will disagree with physical expectation.",
            rootCause:
              "State machine allowed powerState=ON without assigning fanSpeed≥1, or speed cycle wrapped to 0 without flipping power OFF.",
            evidence: { id, power, fanSpeed, airRpm, airflowCfm, wattage },
            fixSteps: [
              "PATCH appliance: set powerState=OFF when fanSpeed hits 0, or set fanSpeed=1 when forcing ON.",
              "In actuate VICTORY branch, keep invariant: nextSpeed===0 ⇒ powerState='OFF' else 'ON' (already present — verify callers of /api/appliances).",
              "Add DB check constraint or API validator: NOT (power_state='ON' AND fan_speed=0) for fan devices.",
            ],
            codeHints: [
              "src/app/api/actuate/route.ts VICTORY branch",
              "src/app/api/appliances/route.ts POST fanSpeed updates",
            ],
            affectedModules: ["appliances API", "actuate API", "SmartHouseSimulator"],
            confidence: 0.94,
          })
        );
      }
      if (power === "OFF" && (fanSpeed > 0 || airRpm > 0 || wattage > 0)) {
        findings.push(
          finding("agent_iot", {
            severity: "HIGH",
            category: "IOT_STATE_INCOHERENCE",
            title: `Fan ${a.name} is OFF but telemetry still non-zero (speed=${fanSpeed}, rpm=${airRpm}, W=${wattage})`,
            symptom: "Phantom spinning / power draw while relay reports OFF.",
            rootCause: "OFF transition did not zero derived telemetry fields (airRpm, airflowCfm, activeWattage, fanSpeed).",
            evidence: { id, power, fanSpeed, airRpm, airflowCfm, wattage },
            fixSteps: [
              "On every power→OFF path, zero fanSpeed, airRpm, airflowCfm, activeWattage.",
              "Run SQL: UPDATE appliances SET fan_speed=0, air_rpm=0, airflow_cfm=0, active_wattage=0 WHERE id='fan_table' AND power_state='OFF'.",
              "Add regression test for OFF invariant.",
            ],
            codeHints: ["src/app/api/actuate/route.ts power OFF branch", "src/app/api/appliances/route.ts"],
            affectedModules: ["actuate API", "appliances"],
            confidence: 0.95,
          })
        );
      }
      if (power === "ON" && fanSpeed > 0) {
        const expectedRpm = 420 + fanSpeed * 260;
        const expectedCfm = 130 + fanSpeed * 75;
        if (Math.abs(airRpm - expectedRpm) > 80) {
          findings.push(
            finding("agent_iot", {
              severity: "MEDIUM",
              category: "FAN_PHYSICS_DRIFT",
              title: `Fan RPM ${airRpm} diverges from speed-tier model (expected ~${expectedRpm})`,
              symptom: "Airflow physics model and stored RPM inconsistent.",
              rootCause: "Manual appliance PATCH set fanSpeed without recomputing airRpm, or legacy seed values differ from actuate formula.",
              evidence: { fanSpeed, airRpm, expectedRpm, airflowCfm, expectedCfm },
              fixSteps: [
                "Recompute: airRpm = 420 + fanSpeed*260; airflowCfm = 130 + fanSpeed*75; wattage = 12 + fanSpeed*11.",
                "Ensure BOTH actuate and appliances POST use the same physics constants (extract to src/lib/iot-physics.ts).",
              ],
              codeHints: [
                "src/app/api/actuate/route.ts airRpm = 420 + nextSpeed * 260",
                "src/app/api/appliances/route.ts airRpm = 450 + fanSpeed * 250  ← CONSTANT MISMATCH",
              ],
              affectedModules: ["actuate API", "appliances API"],
              confidence: 0.97,
            })
          );
        }
        // Constant mismatch between routes is a structural bug — always flag if formulas differ in codebase intent
      }
    }

    // Lamp
    if (id.includes("lamp")) {
      if (power === "ON" && brightness <= 0) {
        findings.push(
          finding("agent_iot", {
            severity: "MEDIUM",
            category: "IOT_STATE_INCOHERENCE",
            title: `Lamp ${a.name} ON with brightness=${brightness}%`,
            symptom: "Illumination state incoherent.",
            rootCause: "ON transition did not set brightness default (80).",
            evidence: { id, power, brightness, wattage },
            fixSteps: [
              "When setting lamp ON, default brightness=80, activeWattage=12.",
              "When OFF, brightness can remain as last-set memory OR zero — pick one policy and apply consistently.",
            ],
            codeHints: ["src/app/api/actuate/route.ts lamp branch"],
            affectedModules: ["actuate API", "SmartHouseSimulator"],
            confidence: 0.9,
          })
        );
      }
      if (power === "OFF" && wattage > 0) {
        findings.push(
          finding("agent_iot", {
            severity: "MEDIUM",
            category: "PHANTOM_WATTAGE",
            title: `Lamp ${a.name} reports ${wattage}W while OFF`,
            symptom: "Power budget accounting inflated.",
            rootCause: "activeWattage not cleared on OFF.",
            evidence: { id, wattage, power },
            fixSteps: ["Zero activeWattage on OFF for all device classes."],
            codeHints: ["actuate API OFF path"],
            affectedModules: ["actuate API"],
            confidence: 0.92,
          })
        );
      }
    }

    // AC
    if (id.includes("ac")) {
      if (power === "ON" && (temp < 16 || temp > 30)) {
        findings.push(
          finding("agent_iot", {
            severity: "HIGH",
            category: "AC_TEMP_OUT_OF_RANGE",
            title: `AC setpoint ${temp}°C outside safe 16–30°C band`,
            symptom: "Compressor target physically unreasonable / unsafe.",
            rootCause: "Temperature step logic or manual PATCH wrote out-of-range value.",
            evidence: { id, temp, wattage, power },
            fixSteps: [
              "Clamp temperature to [18, 26] in POINTING_UP step and appliances POST.",
              "Reset this device to 22°C.",
            ],
            codeHints: ["src/app/api/actuate/route.ts temps = [24,22,20,18]"],
            affectedModules: ["actuate API"],
            confidence: 0.93,
          })
        );
      }
      if (power === "ON" && wattage < 100) {
        findings.push(
          finding("agent_iot", {
            severity: "MEDIUM",
            category: "AC_LOAD_ANOMALY",
            title: `AC ON but activeWattage=${wattage}W (expected ≥1000W)`,
            symptom: "Compressor load not modeled.",
            rootCause: "ON path missed activeWattage assignment.",
            evidence: { id, wattage, temp },
            fixSteps: ["Set activeWattage = 1000 + (26 - temp) * 120 when AC ON."],
            codeHints: ["actuate API AC branch"],
            affectedModules: ["actuate API"],
            confidence: 0.88,
          })
        );
      }
    }

    // Heater R2
    if (id.includes("heater") && power === "ON" && wattage < 500) {
      findings.push(
        finding("agent_iot", {
          severity: "HIGH",
          category: "HEATER_LOAD_ANOMALY",
          title: "Radiant heater ON without kilowatt-scale load",
          symptom: `Heater ON but wattage=${wattage}W — coil not modeled as energized.`,
          rootCause: "R2 actuation path set power ON without activeWattage=2000.",
          evidence: { id, power, wattage },
          fixSteps: ["On heater ON, force activeWattage=2000, targetValue=2000."],
          codeHints: ["actuate API heater branch"],
          affectedModules: ["actuate API", "HazardSentinel"],
          confidence: 0.9,
        })
      );
    }

    // MQTT topic sanity
    const topic = String(a.mqttTopic || "");
    if (!topic || topic === "home/device") {
      findings.push(
        finding("agent_iot", {
          severity: "LOW",
          category: "MQTT_TOPIC_GENERIC",
          title: `Appliance ${a.name} uses generic MQTT topic '${topic || "(empty)"}'`,
          symptom: "Topic collisions possible on shared broker.",
          rootCause: "Seed or migration left default mqttTopic instead of home/<room>/<device>.",
          evidence: { id, mqttTopic: topic, location: a.location },
          fixSteps: [
            `Set mqttTopic to 'home/${String(a.location).toLowerCase().replace(/\\s+/g, "/")}/${id}'.`,
            "Update seed.ts defaults for all appliances.",
          ],
          codeHints: ["src/db/seed.ts mqttTopic fields", "appliances.mqtt_topic"],
          affectedModules: ["seed", "appliances"],
          confidence: 0.85,
        })
      );
    }
  }

  // Household power anomaly
  if (snap.system.totalPowerW > 8000) {
    findings.push(
      finding("agent_iot", {
        severity: "CRITICAL",
        category: "POWER_BUDGET_EXCEEDED",
        title: `Household instantaneous load ${snap.system.totalPowerW.toFixed(0)}W exceeds 8 kW safety budget`,
        symptom: "Simultaneous heater+geyser+AC could trip breaker / fire risk in real deployment.",
        rootCause: "No global power governor across R1/R2 devices.",
        evidence: { totalPowerW: snap.system.totalPowerW, active: snap.system.activeAppliances },
        fixSteps: [
          "Implement power governor: reject new R2 ON if totalPowerW + deviceW > 6000.",
          "Admin action: turn off heater or geyser immediately.",
          "Add SysPulse continuous monitor threshold at 5 kW WARNING, 8 kW CRITICAL.",
        ],
        codeHints: ["SmartHouseSimulator totalPowerW", "actuate API pre-check"],
        affectedModules: ["actuate API", "SmartHouseSimulator"],
        confidence: 0.96,
      })
    );
  }

  traces.push(trace("agent_iot", "PRESCRIBE", `RelayWatch findings=${findings.length}`, Date.now() - t0));
  return { findings, traces };
}

function runHazardSentinel(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_safety", "OBSERVE", "Auditing R2 devices, handshake logs, hazard exposure", 10));

  const r2Apps = snap.appliances.filter((a) => a.riskTier === "R2");
  const r2On = r2Apps.filter((a) => a.powerState === "ON");
  const logs = snap.recentLogs;

  // R2 ON without handshake evidence
  for (const a of r2On) {
    const handshakeLogs = logs.filter(
      (l) =>
        l.applianceId === a.id &&
        l.status === "ACTUATED" &&
        (String(l.gesture).includes("Secondary") || String(l.gesture).includes("THUMBS"))
    );
    const anyActuated = logs.filter((l) => l.applianceId === a.id && l.status === "ACTUATED");

    if (anyActuated.length > 0 && handshakeLogs.length === 0) {
      findings.push(
        finding("agent_safety", {
          severity: "CRITICAL",
          category: "R2_HANDSHAKE_BYPASS",
          title: `CRITICAL: R2 device ${a.name} is ON without secondary-handshake evidence`,
          symptom:
            "A high-hazard actuator (heater/geyser/lock) is energized/unlocked but audit trail lacks THUMBS_UP secondary confirmation.",
          rootCause:
            "Possible paths: (1) direct POST /api/appliances bypassing intent gate, (2) actuate with isSecondaryHandshakeGesture true without prior PRIMARY arm, (3) seed default ON (deadbolt), (4) baseline B0/B1/B2 mode actuating R2 without handshake.",
          evidence: {
            applianceId: a.id,
            powerState: a.powerState,
            requiresHandshake: a.requiresHandshake,
            recentActuations: anyActuated.length,
            handshakeActuations: handshakeLogs.length,
            hazard: a.hazardDescription,
          },
          fixSteps: [
            "IMMEDIATE: Switch device OFF via Admin or Smart House simulator if unintended (heater/geyser).",
            "Block direct /api/appliances power ON for requiresHandshake=true devices unless adminOverride=true.",
            "In actuate route, require a prior HANDSHAKE_PENDING log within 5s before accepting isSecondaryHandshakeGesture.",
            "Disable B0/B1/B2 baseline modes from actuating R2 entirely (force STEADYGATE for riskTier=R2).",
            "Add HazardSentinel continuous alert webhook for any R2 rising-edge without handshake pair.",
          ],
          codeHints: [
            "src/app/api/appliances/route.ts POST — no R2 guard",
            "src/app/api/actuate/route.ts isSecondaryHandshakeGesture",
            "src/lib/steady-gate.ts R2 branch",
          ],
          affectedModules: ["appliances API", "actuate API", "steady-gate", "HazardSentinel"],
          confidence: 0.97,
        })
      );
    }
  }

  // Deadbolt unlatched
  const deadbolt = snap.appliances.find((a) => String(a.id).includes("deadbolt"));
  if (deadbolt && deadbolt.powerState === "OFF") {
    findings.push(
      finding("agent_safety", {
        severity: "HIGH",
        category: "PERIMETER_UNLATCHED",
        title: "Front entrance deadbolt is UNLATCHED",
        symptom: "Physical premise security perimeter open.",
        rootCause:
          "Deadbolt uses powerState ON=LOCKED convention. OFF means unlatched — either intentional unlock after handshake or seed/demo toggle.",
        evidence: { id: deadbolt.id, powerState: deadbolt.powerState },
        fixSteps: [
          "If unintended, re-lock via FIST emergency gesture or Admin override SET power=ON.",
          "Document ON=LOCKED semantics in UI badges (already shown as LOCKED/UNLATCHED).",
          "Auto-relock timer: if UNLATCHED > 60s without presence, re-engage bolt.",
        ],
        codeHints: ["SmartHouseSimulator deadbolt panel", "FIST emergency stop semantics"],
        affectedModules: ["SmartHouseSimulator", "actuate API"],
        confidence: 0.9,
      })
    );
  }

  // Heater on
  const heater = snap.appliances.find((a) => String(a.id).includes("heater"));
  if (heater && heater.powerState === "ON") {
    findings.push(
      finding("agent_safety", {
        severity: "CRITICAL",
        category: "R2_HAZARD_ACTIVE",
        title: "Radiant quartz heater coils ENERGIZED (450°C class hazard)",
        symptom: "Active fire ignition source in bedroom zone.",
        rootCause: "R2 handshake completed or bypass occurred. Continuous monitoring required.",
        evidence: {
          wattage: heater.activeWattage,
          power: heater.powerState,
        },
        fixSteps: [
          "Verify last actuation log shows Secondary Handshake.",
          "Ensure no curtains/blankets in hazard description zone (operational SOP).",
          "Admin may force OFF if session unattended.",
        ],
        codeHints: ["HazardSentinel continuous watch", "actuate heater path"],
        affectedModules: ["HazardSentinel", "SmartHouseSimulator"],
        confidence: 0.94,
      })
    );
  }

  // Baseline mode R2 actuation
  const r2Baseline = logs.filter(
    (l) =>
      l.riskTier === "R2" &&
      l.status === "ACTUATED" &&
      l.baselineMode &&
      l.baselineMode !== "STEADYGATE"
  );
  if (r2Baseline.length > 0) {
    findings.push(
      finding("agent_safety", {
        severity: "CRITICAL",
        category: "BASELINE_R2_ACTUATION",
        title: "Prior-art baseline mode actuated R2 hazard device",
        symptom: "B0/B1/B2 lack two-gesture handshake — this is a safety policy violation.",
        rootCause:
          "evaluateIntentGate baseline branches return ACTUATED for any appliance including R2 without handshake requirement.",
        evidence: { count: r2Baseline.length, modes: r2Baseline.map((l) => l.baselineMode) },
        fixSteps: [
          "HARD FIX: At top of B0/B1/B2 branches, if appliance.riskTier==='R2' return REJECTED with rejectCode HANDSHAKE_TIMEOUT and explanation 'Baselines cannot actuate R2'.",
          "Add unit test covering B0+heater_radiant must not actuate.",
          "Admin: switch mode to STEADYGATE immediately.",
        ],
        codeHints: [
          "src/lib/steady-gate.ts mode === 'B0_RAW' block",
          "src/lib/steady-gate.ts mode === 'B1_WAKE_STATE'",
          "src/lib/steady-gate.ts mode === 'B2_FIXED_DWELL'",
        ],
        affectedModules: ["steady-gate", "HazardSentinel"],
        confidence: 0.99,
      })
    );
  }

  // requiresHandshake flag consistency
  for (const a of r2Apps) {
    if (!a.requiresHandshake) {
      findings.push(
        finding("agent_safety", {
          severity: "HIGH",
          category: "R2_FLAG_MISMATCH",
          title: `R2 appliance ${a.name} has requiresHandshake=false`,
          symptom: "Risk tier says R2 but handshake flag cleared — policy drift.",
          rootCause: "Seed or manual update desynced requiresHandshake from riskTier.",
          evidence: { id: a.id, riskTier: a.riskTier, requiresHandshake: a.requiresHandshake },
          fixSteps: [
            "SQL: UPDATE appliances SET requires_handshake=true WHERE risk_tier='R2'.",
            "Add invariant in appliances POST: riskTier R2 ⇒ requiresHandshake true.",
          ],
          codeHints: ["src/db/seed.ts", "appliances.requires_handshake"],
          affectedModules: ["seed", "appliances"],
          confidence: 0.95,
        })
      );
    }
  }

  traces.push(
    trace("agent_safety", "ESCALATE", `HazardSentinel findings=${findings.length} (safety-first)`, Date.now() - t0)
  );
  return { findings, traces };
}

function runAdaptLearner(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_personalize", "OBSERVE", "Inspecting personalized prototypes & flexibility params", 8));

  for (const u of snap.users) {
    let prototypes: Record<string, { confidenceBoost?: number; flexTol?: number }> = {};
    if (u.personalizedPrototypes) {
      try {
        prototypes = JSON.parse(String(u.personalizedPrototypes));
      } catch {
        findings.push(
          finding("agent_personalize", {
            severity: "HIGH",
            category: "PROTOTYPE_JSON_CORRUPT",
            title: `Corrupt personalizedPrototypes JSON for ${u.name}`,
            symptom: "JSON.parse failed — personalization boosts disabled for this user.",
            rootCause: "Malformed JSON written to users.personalized_prototypes.",
            evidence: { userId: u.id, raw: String(u.personalizedPrototypes).slice(0, 120) },
            fixSteps: [
              "Reset prototypes to default empty object {} via personalize API.",
              "Re-run Personalize for OPEN_PALM, VICTORY, FIST.",
              "Sanitize input in /api/personalize before JSON.stringify.",
            ],
            codeHints: ["src/app/api/personalize/route.ts", "users.personalized_prototypes"],
            affectedModules: ["personalize API", "users"],
            confidence: 0.96,
          })
        );
        continue;
      }
    }

    for (const [g, cfg] of Object.entries(prototypes)) {
      const boost = cfg.confidenceBoost ?? 1;
      if (boost > 1.2) {
        findings.push(
          finding("agent_personalize", {
            severity: "MEDIUM",
            category: "PROTOTYPE_OVERBOOST",
            title: `Prototype boost for ${g} on ${u.name} is ${boost} (>1.20 cap risk)`,
            symptom: "Over-boosted prototype may force misclassification of neighboring gestures.",
            rootCause:
              "Repeated Personalize clicks accumulated confidenceBoost without decay. Cap is 1.25 in API but >1.20 already distorts margins.",
            evidence: { userId: u.id, gesture: g, confidenceBoost: boost, flexTol: cfg.flexTol },
            fixSteps: [
              "Decay boost: set confidenceBoost = min(boost, 1.12) for production.",
              "Add personalize rate-limit: max +0.05 per gesture per hour.",
              "Require margin still > 0.12 after boost in offline replay before committing.",
            ],
            codeHints: [
              "src/app/api/personalize/route.ts Math.min(1.25, ...)",
              "src/lib/hand-gesture-engine.ts scores[key] *= boost",
            ],
            affectedModules: ["personalize API", "hand-gesture-engine"],
            confidence: 0.88,
          })
        );
      }
    }

    const flex = Number(u.fingerFlexibility ?? 1);
    if (flex < 0.7) {
      findings.push(
        finding("agent_personalize", {
          severity: "MEDIUM",
          category: "FLEXIBILITY_TOO_LOW",
          title: `fingerFlexibility=${flex} for ${u.name} may mark all fingers as EXT`,
          symptom: "extendThreshold = 0.58 * flex becomes very low — fist may classify as open palm.",
          rootCause: "Over-adapted flexibility parameter from personalize slider/API.",
          evidence: { userId: u.id, fingerFlexibility: flex, extendThreshold: 0.58 * flex },
          fixSteps: [
            "Clamp fingerFlexibility to [0.75, 1.15] in personalize API.",
            "Reset this user to 0.9 and re-personalize carefully.",
          ],
          codeHints: [
            "src/lib/hand-gesture-engine.ts const extendThreshold = 0.58 * flexScale",
            "src/app/api/personalize/route.ts",
          ],
          affectedModules: ["hand-gesture-engine", "personalize API"],
          confidence: 0.9,
        })
      );
    }

    // Tremor user without prototypes
    const cond = String(u.condition || "").toLowerCase();
    if (
      (cond.includes("tremor") || cond.includes("parkinson") || cond.includes("dystonia")) &&
      Object.keys(prototypes).length === 0
    ) {
      findings.push(
        finding("agent_personalize", {
          severity: "LOW",
          category: "MISSING_PROTOTYPES",
          title: `Motor-impaired user ${u.name} has empty personalized prototypes`,
          symptom: "No per-gesture boosts — relying only on global PMS.",
          rootCause: "User never used Personalize button after enrolment.",
          evidence: { userId: u.id, condition: u.condition },
          fixSteps: [
            "Guide user through Personalize for OPEN_PALM, VICTORY, THUMBS_UP, FIST (4 taps).",
            "Admin can seed mild boosts 1.05 for all five core gestures.",
          ],
          codeHints: ["LiveCameraStream Personalize button", "POST /api/personalize"],
          affectedModules: ["LiveCameraStream", "personalize API"],
          confidence: 0.83,
        })
      );
    }
  }

  // Weak supervision runaway
  const nudges = snap.calibrationEvents.filter((c) =>
    String(c.reason || "").toLowerCase().includes("weak supervision")
  );
  if (nudges.length >= 5) {
    findings.push(
      finding("agent_personalize", {
        severity: "MEDIUM",
        category: "NUDGE_RUNAWAY",
        title: `${nudges.length} weak-supervision +4% A₀ nudges detected — possible amplitude inflation`,
        symptom: "Repeated retries may inflate A₀ until dwell becomes excessively long.",
        rootCause: "No cumulative cap on closed-loop amplitude nudges per session.",
        evidence: { nudgeCount: nudges.length },
        fixSteps: [
          "Cap cumulative nudge to +20% of enrolment A₀ per 24h.",
          "After 3 nudges, require full 10-s re-enrolment instead of silent +4%.",
        ],
        codeHints: ["src/app/api/actuate/route.ts wasReAttempt nudge", "calibration_events"],
        affectedModules: ["actuate API", "calibrationEvents"],
        confidence: 0.86,
      })
    );
  }

  traces.push(
    trace("agent_personalize", "PRESCRIBE", `AdaptLearner findings=${findings.length}`, Date.now() - t0)
  );
  return { findings, traces };
}

function runSysPulse(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(trace("agent_health", "OBSERVE", "Checking DB population, log orphans, system liveness", 7));

  if (snap.system.totalAppliances === 0) {
    findings.push(
      finding("agent_health", {
        severity: "CRITICAL",
        category: "EMPTY_APPLIANCE_TABLE",
        title: "No appliances in database — smart house is empty",
        symptom: "Seed did not run or table was wiped.",
        rootCause: "seedDatabase() not invoked or failed silently.",
        evidence: { totalAppliances: 0 },
        fixSteps: [
          "GET /api/appliances to trigger seed.",
          "Verify DATABASE_URL and drizzle push succeeded.",
          "Check server logs for Seed error.",
        ],
        codeHints: ["src/db/seed.ts", "src/app/api/appliances/route.ts"],
        affectedModules: ["seed", "db"],
        confidence: 0.99,
      })
    );
  }

  if (snap.users.length === 0) {
    findings.push(
      finding("agent_health", {
        severity: "CRITICAL",
        category: "EMPTY_USER_TABLE",
        title: "No user profiles — intent gating cannot run",
        symptom: "Actuation requires userId.",
        rootCause: "Users seed missing.",
        evidence: {},
        fixSteps: ["GET /api/users to seed default profiles.", "Create enrolment via 10-s wizard."],
        codeHints: ["src/db/seed.ts users insert"],
        affectedModules: ["seed", "users"],
        confidence: 0.99,
      })
    );
  }

  // Orphan logs (appliance id not in set)
  const appIds = new Set(snap.appliances.map((a) => String(a.id)));
  const orphanLogs = snap.recentLogs.filter((l) => !appIds.has(String(l.applianceId)));
  if (orphanLogs.length > 0) {
    findings.push(
      finding("agent_health", {
        severity: "MEDIUM",
        category: "ORPHAN_ACTUATION_LOGS",
        title: `${orphanLogs.length} actuation logs reference missing appliance IDs`,
        symptom: "Broken referential integrity (no FK constraint).",
        rootCause: "Appliance deleted/changed id without cascading logs, or test IDs leaked.",
        evidence: {
          orphanIds: [...new Set(orphanLogs.map((l) => l.applianceId))],
        },
        fixSteps: [
          "Delete orphan logs or re-map appliance_id.",
          "Consider Drizzle FK: applianceId references appliances.id.",
        ],
        codeHints: ["src/db/schema.ts actuationLogs", "GET /api/logs"],
        affectedModules: ["schema", "logs"],
        confidence: 0.9,
      })
    );
  }

  if (snap.system.lastActuationAgeMs !== null && snap.system.lastActuationAgeMs > 3600000) {
    findings.push(
      finding("agent_health", {
        severity: "INFO",
        category: "STALE_SESSION",
        title: "No actuations in the last hour",
        symptom: "System idle — agents still watching.",
        rootCause: "Normal idle or demo not running.",
        evidence: { lastActuationAgeMs: snap.system.lastActuationAgeMs },
        fixSteps: ["No action unless monitoring a live pilot."],
        codeHints: [],
        affectedModules: ["runtime"],
        confidence: 0.7,
      })
    );
  }

  // Missing critical R2 devices
  const hasHeater = snap.appliances.some((a) => String(a.id).includes("heater"));
  const hasGeyser = snap.appliances.some((a) => String(a.id).includes("geyser"));
  const hasLock = snap.appliances.some((a) => String(a.id).includes("deadbolt"));
  if (!hasHeater || !hasGeyser || !hasLock) {
    findings.push(
      finding("agent_health", {
        severity: "HIGH",
        category: "INCOMPLETE_R2_FLEET",
        title: "One or more R2 hazard devices missing from appliance table",
        symptom: `heater=${hasHeater}, geyser=${hasGeyser}, deadbolt=${hasLock}`,
        rootCause: "Partial seed or manual deletion.",
        evidence: { hasHeater, hasGeyser, hasLock },
        fixSteps: ["Re-seed appliances or insert missing R2 rows from seed.ts."],
        codeHints: ["src/db/seed.ts"],
        affectedModules: ["seed"],
        confidence: 0.93,
      })
    );
  }

  traces.push(trace("agent_health", "DIAGNOSE", `SysPulse findings=${findings.length}`, Date.now() - t0));
  return { findings, traces };
}

function runChiefDebugger(
  snap: AnalysisSnapshot,
  specialistFindings: FindingDraft[]
): AgentAnalysisResult {
  const findings: FindingDraft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();

  traces.push(
    trace(
      "agent_orchestrator",
      "OBSERVE",
      `Correlating ${specialistFindings.length} specialist findings into causal graph`,
      15
    )
  );

  // Duplicate suppression by title similarity / category+module
  const sorted = [...specialistFindings].sort(
    (a, b) => severityRank(b.severity) - severityRank(a.severity)
  );

  // Cross-agent correlation: vision ambiguity + intent false reject
  const hasAmbiguity = specialistFindings.some((f) => f.category === "GESTURE_AMBIGUITY");
  const hasFalseReject = specialistFindings.some((f) => f.category === "FALSE_REJECT_RATE");
  if (hasAmbiguity && hasFalseReject) {
    findings.push(
      finding("agent_orchestrator", {
        severity: "HIGH",
        category: "CORRELATED_ROOT_CAUSE",
        title: "Correlated root cause: gesture ambiguity cascading into false-reject spiral",
        symptom:
          "VisionGuard and IntentCritic both fired. Users fail margin check then retry into dwell timeouts.",
        rootCause:
          "Primary defect is upstream kinematic separation (Vision). Intent fusion and dwell merely amplify the symptom as false rejects. Fix vision margins first; intent thresholds second.",
        evidence: {
          chain: ["GESTURE_AMBIGUITY", "AMBIGUOUS_CLASS rejects", "retry", "GESTURE_UNSTABLE dwell miss", "FALSE_REJECT_RATE"],
        },
        fixSteps: [
          "PRIORITY 1: Apply VisionGuard fix (margin floor + VICTORY curl weight).",
          "PRIORITY 2: Personalize VICTORY/POINTING for active tremor user.",
          "PRIORITY 3: Only then loosen IntentCritic dwell if reject rate still > 40%.",
          "Do NOT widen S_norm floor first — that masks safety.",
        ],
        codeHints: [
          "Fix order enforced by ChiefDebugger causal graph",
          "hand-gesture-engine.ts → steady-gate.ts → DwellRingController.tsx",
        ],
        affectedModules: ["hand-gesture-engine", "steady-gate", "DwellRingController"],
        confidence: 0.94,
      })
    );
  }

  // IoT incoherence + safety
  const iotIssues = specialistFindings.filter((f) => f.category.startsWith("IOT_") || f.category.includes("PHYSICS"));
  const safetyCritical = specialistFindings.filter((f) => f.severity === "CRITICAL" && f.agentId === "agent_safety");
  if (iotIssues.length > 0 && safetyCritical.length > 0) {
    findings.push(
      finding("agent_orchestrator", {
        severity: "CRITICAL",
        category: "CORRELATED_ROOT_CAUSE",
        title: "IoT state incoherence intersecting with live R2 hazard",
        symptom: "RelayWatch and HazardSentinel both elevated — physical truth uncertain while hazard active.",
        rootCause:
          "Unreliable telemetry under hazard conditions is a functional-safety failure. Absolute-state SET path and handshake audit must be repaired before demo to third parties.",
        evidence: {
          iotCount: iotIssues.length,
          safetyCritical: safetyCritical.map((f) => f.title),
        },
        fixSteps: [
          "Force all R2 devices OFF from Admin kill switch.",
          "Repair IoT invariants (fan/lamp/heater wattage zeroing).",
          "Add appliances API R2 guard.",
          "Re-run agent scan; require 0 CRITICAL before leaving Admin mode.",
        ],
        codeHints: ["Admin Console Kill Switch", "appliances POST R2 guard", "actuate OFF zeroing"],
        affectedModules: ["appliances API", "actuate API", "HazardSentinel", "RelayWatch"],
        confidence: 0.96,
      })
    );
  }

  // Fan physics: only flag if live DB rows diverge from shared iot-physics model
  const fan = snap.appliances.find((a) => String(a.id).includes("fan"));
  if (fan && fan.powerState === "ON" && Number(fan.fanSpeed) > 0) {
    const speed = Number(fan.fanSpeed);
    const expectedRpm = 420 + speed * 260;
    if (Math.abs(Number(fan.airRpm) - expectedRpm) > 80) {
      findings.push(
        finding("agent_orchestrator", {
          severity: "HIGH",
          category: "STRUCTURAL_CODE_DEFECT",
          title: "Fan telemetry diverges from shared iot-physics model",
          symptom: `Live RPM ${fan.airRpm} vs expected ${expectedRpm} at speed ${speed}.`,
          rootCause:
            "A write path bypassed src/lib/iot-physics.ts fanTelemetry(), or legacy row not backfilled.",
          evidence: { fanSpeed: speed, airRpm: fan.airRpm, expectedRpm },
          fixSteps: [
            "PATCH fan through /api/appliances with fanSpeed to recompute telemetry.",
            "Ensure actuate + appliances both import fanTelemetry from iot-physics.ts.",
          ],
          codeHints: ["src/lib/iot-physics.ts fanTelemetry", "appliances/actuate routes"],
          affectedModules: ["iot-physics", "appliances API", "actuate API"],
          confidence: 0.95,
        })
      );
    }
  }

  // R2 bypass: only CRITICAL if live R2 ON without handshake evidence (handled by HazardSentinel).
  // Emit INFO confirmation when guard path is healthy (no un-handshaked R2 rising edges in logs).
  const r2OnNoHandshake = specialistFindings.some(
    (f) => f.category === "R2_HANDSHAKE_BYPASS" || f.category === "BASELINE_R2_ACTUATION"
  );
  if (!r2OnNoHandshake) {
    traces.push(
      trace(
        "agent_orchestrator",
        "DIAGNOSE",
        "R2 intent-gate guard appears healthy this window (no handshake-bypass finding from HazardSentinel)",
        4
      )
    );
  }

  // Summary health score finding
  const crit = [...specialistFindings, ...findings].filter((f) => f.severity === "CRITICAL").length;
  const high = [...specialistFindings, ...findings].filter((f) => f.severity === "HIGH").length;
  traces.push(
    trace(
      "agent_orchestrator",
      "DIAGNOSE",
      `Causal graph complete. Specialist=${specialistFindings.length}, Orchestrator-extra=${findings.length}, CRITICAL=${crit}, HIGH=${high}`,
      Date.now() - t0
    )
  );
  traces.push(
    trace(
      "agent_orchestrator",
      "PRESCRIBE",
      crit > 0
        ? "Admin must resolve all CRITICAL findings before production demo. Ordered fix packages attached."
        : high > 0
        ? "No critical hazards. Schedule HIGH fixes in next engineering pass."
        : "System clean — continue continuous monitoring.",
      5
    )
  );

  return { findings, traces };
}

/** Build analysis snapshot from live DB rows */
export function buildSnapshot(input: {
  appliances: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  recentLogs: Array<Record<string, unknown>>;
  calibrationEvents: Array<Record<string, unknown>>;
  telemetry?: TelemetrySample[];
  apiProbes?: ApiProbe[];
}): AnalysisSnapshot {
  const logs = input.recentLogs;
  const actuated = logs.filter((l) => l.status === "ACTUATED").length;
  const rejected = logs.filter((l) => l.status === "REJECTED").length;
  const handshake = logs.filter((l) => l.status === "HANDSHAKE_PENDING").length;
  const total = logs.length || 1;

  const avg = (key: string) =>
    logs.length === 0
      ? 0
      : logs.reduce((s, l) => s + Number(l[key] || 0), 0) / logs.length;

  const activeAppliances = input.appliances.filter((a) => a.powerState === "ON");
  const totalPowerW = activeAppliances.reduce((s, a) => s + Number(a.activeWattage || 0), 0);

  let lastActuationAgeMs: number | null = null;
  if (logs[0]?.createdAt) {
    lastActuationAgeMs = Date.now() - new Date(String(logs[0].createdAt)).getTime();
  }

  return {
    appliances: input.appliances,
    users: input.users,
    recentLogs: input.recentLogs,
    calibrationEvents: input.calibrationEvents,
    telemetry: input.telemetry ?? [],
    apiProbes: input.apiProbes ?? [],
    system: {
      totalAppliances: input.appliances.length,
      activeAppliances: activeAppliances.length,
      totalPowerW,
      rejectRate: rejected / total,
      actuatedCount: actuated,
      rejectedCount: rejected,
      handshakePendingCount: handshake,
      avgIntentScore: avg("intentScore"),
      avgStabilityNorm: avg("stabilityNorm"),
      avgAttention: avg("attention"),
      r2DevicesOn: input.appliances.filter((a) => a.riskTier === "R2" && a.powerState === "ON")
        .length,
      tremorUsers: input.users.filter((u) =>
        /tremor|parkinson|dystonia/i.test(String(u.condition || ""))
      ).length,
      lastActuationAgeMs,
    },
  };
}

/**
 * Run the full multi-agent council on a live snapshot.
 * Order: specialists in parallel-logical sequence → ChiefDebugger correlator.
 */
export function runMultiAgentCouncil(snap: AnalysisSnapshot): {
  findings: FindingDraft[];
  traces: AgentTraceStep[];
  summary: string;
} {
  const allFindings: FindingDraft[] = [];
  const allTraces: AgentTraceStep[] = [];

  const specialists = [
    runFrontendRuntimeGuard, // browser truth first — everything downstream depends on it
    runSceneRobustness,
    runIntentContinuity,
    runApiGuard,
    runVisionGuard,
    runTremorScope,
    runIntentCritic,
    runRelayWatch,
    runHazardSentinel,
    runAdaptLearner,
    runSysPulse,
  ];

  for (const agentFn of specialists) {
    const result = agentFn(snap);
    allFindings.push(...result.findings);
    allTraces.push(...result.traces);
  }

  const chief = runChiefDebugger(snap, allFindings);
  allFindings.push(...chief.findings);
  allTraces.push(...chief.traces);

  // Sort by severity
  allFindings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const crit = allFindings.filter((f) => f.severity === "CRITICAL").length;
  const high = allFindings.filter((f) => f.severity === "HIGH").length;
  const med = allFindings.filter((f) => f.severity === "MEDIUM").length;

  const summary =
    crit > 0
      ? `⛔ ${crit} CRITICAL, ${high} HIGH, ${med} MEDIUM — admin action required before safe operation.`
      : high > 0
      ? `⚠ ${high} HIGH, ${med} MEDIUM findings — schedule fixes; system operable with caution.`
      : med > 0
      ? `ℹ ${med} MEDIUM/LOW findings — continuous watch; no immediate blocker.`
      : `✓ Multi-agent council clear — no actionable defects in this scan window.`;

  return { findings: allFindings, traces: allTraces, summary };
}

export { uid, severityRank };
