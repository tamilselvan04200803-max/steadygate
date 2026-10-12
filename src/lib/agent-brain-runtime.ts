/**
 * Runtime-facing specialist agents: they analyse browser telemetry and live API
 * probes. Every finding below is conditional on measured data.
 */
import type {
  AgentAnalysisResult,
  AgentFinding,
  AgentSeverity,
  AgentTraceStep,
  AnalysisSnapshot,
  TelemetrySample,
} from "./agent-types";
import { AGENT_ROSTER } from "./agent-roster";

type Draft = Omit<AgentFinding, "id" | "runId" | "createdAt" | "status" | "resolvedAt">;

const agentOf = (id: string) => AGENT_ROSTER.find((a) => a.id === id)!;

function F(
  agentId: string,
  p: {
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
): Draft {
  const a = agentOf(agentId);
  return {
    agentId: a.id,
    agentName: a.name,
    modelId: a.model.id,
    severity: p.severity,
    category: p.category,
    title: p.title,
    symptom: p.symptom,
    rootCause: p.rootCause,
    evidence: JSON.stringify(p.evidence),
    fixSteps: JSON.stringify(p.fixSteps),
    codeHints: JSON.stringify(p.codeHints || []),
    affectedModules: JSON.stringify(p.affectedModules || []),
    confidence: p.confidence ?? a.model.confidenceFloor + 0.05,
  };
}

function T(agentId: string, phase: AgentTraceStep["phase"], message: string, durationMs = 0): AgentTraceStep {
  const a = agentOf(agentId);
  return { agentId: a.id, agentName: a.name, modelId: a.model.id, phase, message, ts: new Date().toISOString(), durationMs };
}

type VisionPayload = {
  mode?: "SIMULATED" | "WEBCAM";
  modelStatus?: string;
  delegate?: string | null;
  modelSource?: string | null;
  loaderEvents?: Array<{ stage: string; ok: boolean; detail?: string; ms: number }>;
  fps?: number;
  framesTotal?: number;
  framesWithHand?: number;
  detectRate?: number;
  scene?: { luminance: number; contrast: number; clutter: number; gain: number; contrastGain: number; preprocessed: boolean };
  vote?: { committed: string; candidate: string; agreement: number; stableFrames: number } | null;
  intent?: { presenceStreakFrames: number; wristVelocity: number; inRoi: boolean; handScale: number; transit: boolean; reasons: string[]; score: number } | null;
  classifier?: { gesture: string; confidence: number; margin: number } | null;
  cameraError?: string | null;
  jsErrors?: Array<{ message: string; source?: string; ts: number }>;
  userAgent?: string;
  ts?: number;
};

function latestVision(snap: AnalysisSnapshot): { sample: TelemetrySample; p: VisionPayload } | null {
  const v = snap.telemetry.find((t) => (t.payload as { mode?: string }).mode !== undefined);
  return v ? { sample: v, p: v.payload as VisionPayload } : null;
}

/* ------------------------------------------------------------------ */
/* FrontendRuntimeGuard                                                 */
/* ------------------------------------------------------------------ */
export function runFrontendRuntimeGuard(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: Draft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();
  traces.push(T("agent_frontend", "OBSERVE", `Reading ${snap.telemetry.length} browser telemetry samples (last 10 min)`, 4));

  if (snap.telemetry.length === 0) {
    findings.push(
      F("agent_frontend", {
        severity: "HIGH",
        category: "NO_CLIENT_TELEMETRY",
        title: "No browser telemetry received — agents are blind to the frontend",
        symptom: "No /api/telemetry POSTs in the last 10 minutes. The vision pipeline state (model loaded? webcam live? fps?) is unknown.",
        rootCause:
          "Either no client has opened the Live Controller with the webcam, or the telemetry reporter failed (network/CSP), or the page is running an old bundle without vision-runtime.ts.",
        evidence: { telemetrySamples: 0, windowMinutes: 10 },
        fixSteps: [
          "Open the app → Live Controller → click 'Start Live Webcam'. A telemetry POST fires immediately.",
          "In DevTools → Network, confirm POST /api/telemetry returns 200 with a `directives` object.",
          "If blocked, check for console errors from vision-runtime.ts ErrorCollector.",
        ],
        codeHints: ["src/lib/vision-runtime.ts postTelemetry", "src/components/LiveCameraStream.tsx sendTelemetry"],
        affectedModules: ["LiveCameraStream", "telemetry API"],
        confidence: 0.9,
      })
    );
    traces.push(T("agent_frontend", "DIAGNOSE", "Telemetry absent — emitted blind-spot finding", Date.now() - t0));
    return { findings, traces };
  }

  const lv = latestVision(snap);
  if (!lv) return { findings, traces };
  const { p, sample } = lv;
  const ageSec = (Date.now() - new Date(sample.createdAt).getTime()) / 1000;
  const failedStages = (p.loaderEvents || []).filter((e) => !e.ok);
  const okStages = (p.loaderEvents || []).filter((e) => e.ok);

  traces.push(
    T(
      "agent_frontend",
      "REASON",
      `mode=${p.mode} model=${p.modelStatus} delegate=${p.delegate} src=${p.modelSource} fps=${p.fps} detect=${((p.detectRate || 0) * 100).toFixed(0)}% age=${ageSec.toFixed(0)}s failedStages=${failedStages.length}`,
      6
    )
  );

  // 1. Model failed
  if (p.modelStatus === "FAILED") {
    const last = failedStages[failedStages.length - 1];
    findings.push(
      F("agent_frontend", {
        severity: "CRITICAL",
        category: "VISION_MODEL_FAILED",
        title: "MediaPipe HandLandmarker failed to initialise — recognition is NOT running",
        symptom: `Client reported modelStatus=FAILED. Last failing stage: ${last?.stage || "unknown"} — ${last?.detail || p.cameraError || "no detail"}. UI fell back to a synthetic hand.`,
        rootCause: diagnoseLoader(failedStages, p.cameraError || null),
        evidence: { loaderEvents: p.loaderEvents, cameraError: p.cameraError, userAgent: p.userAgent, jsErrors: p.jsErrors },
        fixSteps: loaderFixSteps(failedStages, p.cameraError || null),
        codeHints: ["src/lib/vision-runtime.ts loadHandLandmarker", "public/vision/*.wasm", "public/models/hand_landmarker.task"],
        affectedModules: ["vision-runtime", "LiveCameraStream", "static assets"],
        confidence: 0.97,
      })
    );
  }

  // 2. Silent synthetic mode
  if (p.mode === "SIMULATED" && p.modelStatus !== "FAILED" && ageSec < 120) {
    findings.push(
      F("agent_frontend", {
        severity: "MEDIUM",
        category: "SYNTHETIC_MODE_ACTIVE",
        title: "Controller is showing a synthetic hand, not camera recognition",
        symptom: "Latest telemetry mode=SIMULATED. Gesture labels on screen come from a generator, not from the user's hand.",
        rootCause: "Webcam not started (modelStatus=" + p.modelStatus + "). Any demo in this state is not real recognition.",
        evidence: { mode: p.mode, modelStatus: p.modelStatus, sessionId: sample.sessionId },
        fixSteps: ["Click 'Start Live Webcam' in the Controller.", "Grant camera permission when prompted.", "Confirm the badge turns green: LIVE · GPU/CPU · local."],
        codeHints: ["src/components/LiveCameraStream.tsx startWebcam"],
        affectedModules: ["LiveCameraStream"],
        confidence: 0.95,
      })
    );
  }

  // 3. Degraded delegate / CDN fallback (still working, but explain)
  if (p.modelStatus === "READY") {
    if (p.delegate === "CPU" && failedStages.some((s) => s.stage.includes("_GPU"))) {
      findings.push(
        F("agent_frontend", {
          severity: "LOW",
          category: "GPU_DELEGATE_FALLBACK",
          title: "GPU delegate failed — running HandLandmarker on CPU (WASM)",
          symptom: `fps=${p.fps}. CPU inference is 2–3× slower; expect 12–20 fps on laptops.`,
          rootCause: `WebGL context unavailable or blocked: ${failedStages.find((s) => s.stage.includes("_GPU"))?.detail || "n/a"}. Common on Safari, remote desktops, or hardware-acceleration disabled in Chrome.`,
          evidence: { failedStages, delegate: p.delegate, fps: p.fps, userAgent: p.userAgent },
          fixSteps: [
            "Chrome → chrome://settings/system → enable 'Use graphics acceleration'.",
            "Close other WebGL-heavy tabs; retry Start Webcam.",
            "Accept CPU mode: vision-runtime already lowered detection thresholds; the voter compensates for lower fps.",
          ],
          codeHints: ["src/lib/vision-runtime.ts delegates order"],
          affectedModules: ["vision-runtime"],
          confidence: 0.9,
        })
      );
    }
    if (p.modelSource === "cdn" || okStages.some((s) => s.stage === "wasm_cdn")) {
      findings.push(
        F("agent_frontend", {
          severity: "MEDIUM",
          category: "LOCAL_ASSETS_MISSING",
          title: "Self-hosted vision assets failed; client fell back to CDN",
          symptom: "Local /vision or /models returned an error; the CDN saved the session but offline/air-gapped deployments will break.",
          rootCause: "public/vision/*.wasm or public/models/hand_landmarker.task not deployed, or served with wrong MIME/404.",
          evidence: { loaderEvents: p.loaderEvents },
          fixSteps: [
            "curl -I <origin>/vision/vision_wasm_internal.wasm → expect 200 application/wasm.",
            "curl -I <origin>/models/hand_landmarker.task → expect 200, ~7.8 MB.",
            "Re-copy: cp node_modules/@mediapipe/tasks-vision/wasm/* public/vision/",
          ],
          codeHints: ["public/vision", "public/models"],
          affectedModules: ["static assets"],
          confidence: 0.93,
        })
      );
    }
    // 4. fps collapse
    if ((p.fps || 0) > 0 && (p.fps || 0) < 10 && (p.framesTotal || 0) > 60) {
      findings.push(
        F("agent_frontend", {
          severity: "HIGH",
          category: "FPS_COLLAPSE",
          title: `Vision loop running at ${p.fps} fps — dwell timing and tremor FFT are unreliable`,
          symptom: "Below 10 fps the 30-fps FFT assumption breaks (f₀ estimates alias) and dwell progress stutters.",
          rootCause:
            p.delegate === "CPU"
              ? "CPU delegate on a slow machine, or the tab is throttled/backgrounded."
              : "GPU contention or main-thread blocking (large React re-renders each frame).",
          evidence: { fps: p.fps, delegate: p.delegate, framesTotal: p.framesTotal },
          fixSteps: [
            "Reduce camera constraint to 480×360 in startWebcam.",
            "Keep the tab foregrounded; disable browser power-saver.",
            "If GPU: close other 3D tabs. If CPU: enable hardware acceleration.",
            "Pass the measured fps into extractMotionSignature instead of the hard-coded 30.",
          ],
          codeHints: ["src/components/LiveCameraStream.tsx extractMotionSignature(...,30,...)"],
          affectedModules: ["LiveCameraStream", "signal-processing"],
          confidence: 0.88,
        })
      );
    }
  }

  // 5. JS errors
  const errs = p.jsErrors || [];
  if (errs.length > 0) {
    findings.push(
      F("agent_frontend", {
        severity: errs.some((e) => /detectForVideo|wasm|WebGL/i.test(e.message)) ? "HIGH" : "MEDIUM",
        category: "CLIENT_JS_ERRORS",
        title: `${errs.length} uncaught client error(s) captured in the vision session`,
        symptom: errs.slice(0, 3).map((e) => `• ${e.message}`).join(" "),
        rootCause: "See messages. Errors mentioning detectForVideo/wasm indicate the inference call is throwing per-frame; others are UI regressions.",
        evidence: { errors: errs },
        fixSteps: [
          "Reproduce with DevTools console open on the Controller tab.",
          "If detectForVideo throws: ensure the video element has non-zero videoWidth before the first call (readyState ≥ 2).",
          "Ship fix, rerun council; this finding auto-clears when the next telemetry has no errors.",
        ],
        codeHints: ["src/lib/vision-runtime.ts ErrorCollector"],
        affectedModules: ["LiveCameraStream"],
        confidence: 0.86,
      })
    );
  }

  // 6. Stale telemetry while webcam claimed live
  if (p.mode === "WEBCAM" && ageSec > 45) {
    findings.push(
      F("agent_frontend", {
        severity: "LOW",
        category: "STALE_TELEMETRY",
        title: `Webcam session went silent ${Math.round(ageSec)}s ago`,
        symptom: "Last sample says WEBCAM but no update since; tab likely closed or backgrounded (rAF paused).",
        rootCause: "requestAnimationFrame stops in background tabs; the reporter is frame-driven.",
        evidence: { ageSec: Math.round(ageSec), sessionId: sample.sessionId },
        fixSteps: ["Refocus the tab or restart the webcam.", "Optional: move the telemetry heartbeat to setInterval so idle sessions still report."],
        codeHints: ["LiveCameraStream sendTelemetry cadence"],
        affectedModules: ["LiveCameraStream"],
        confidence: 0.8,
      })
    );
  }

  traces.push(T("agent_frontend", "PRESCRIBE", `FrontendRuntimeGuard findings=${findings.length}`, Date.now() - t0));
  return { findings, traces };
}

function diagnoseLoader(failed: Array<{ stage: string; detail?: string }>, cameraError: string | null): string {
  if (cameraError?.includes("permission")) return "Browser denied camera permission (NotAllowedError). Nothing downstream can run.";
  if (cameraError?.includes("No camera")) return "No video input device (NotFoundError) — headless VM, or camera in use by another app.";
  const stages = failed.map((f) => f.stage);
  if (stages.includes("wasm_local") && stages.includes("wasm_cdn"))
    return "WASM runtime could not be fetched from local /vision nor CDN. Offline, CSP blocking scripts/wasm, or the files are missing.";
  if (stages.some((s) => s.startsWith("model_")) && !stages.some((s) => s.startsWith("wasm_")))
    return "WASM loaded but HandLandmarker.createFromOptions failed for every model/delegate combination — usually a corrupt/404 .task file (must be ~7.8 MB, starts with 'PK') or WebGL+WASM both unavailable.";
  return failed.map((f) => `${f.stage}: ${f.detail}`).join("; ") || "Unknown loader failure";
}

function loaderFixSteps(failed: Array<{ stage: string; detail?: string }>, cameraError: string | null): string[] {
  if (cameraError?.includes("permission"))
    return ["Click the camera icon in the address bar → Allow.", "Reload and press Start Live Webcam again.", "On iOS Safari, camera requires HTTPS."];
  if (cameraError?.includes("No camera")) return ["Attach/enable a webcam.", "Close Zoom/Teams that may hold the device.", "Use the synthetic mode only for UI walkthroughs — it is not recognition."];
  const stages = failed.map((f) => f.stage);
  const steps: string[] = [];
  if (stages.includes("wasm_local")) steps.push("Verify GET /vision/vision_wasm_internal.js and .wasm return 200 (copy from node_modules/@mediapipe/tasks-vision/wasm).");
  if (stages.some((s) => s.startsWith("model_local"))) steps.push("Verify GET /models/hand_landmarker.task is 200 and 7,819,105 bytes; re-download from storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/.");
  if (stages.some((s) => s.includes("_GPU")) && stages.some((s) => s.includes("_CPU"))) steps.push("Both delegates failed: check the browser supports WebAssembly SIMD (Chrome ≥ 91, Safari ≥ 16.4).");
  steps.push("Open DevTools → Network → filter 'wasm' and '.task' to see the exact failing request.");
  steps.push("After fixing, click Start Live Webcam; the badge must read LIVE · GPU · local.");
  return steps;
}

/* ------------------------------------------------------------------ */
/* SceneRobustness                                                      */
/* ------------------------------------------------------------------ */
export function runSceneRobustness(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: Draft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();
  const lv = latestVision(snap);
  traces.push(T("agent_scene", "OBSERVE", "Reading scene statistics from live webcam telemetry", 3));
  if (!lv || lv.p.mode !== "WEBCAM" || lv.p.modelStatus !== "READY") {
    traces.push(T("agent_scene", "DIAGNOSE", "No live webcam session — nothing to assess", Date.now() - t0));
    return { findings, traces };
  }
  const p = lv.p;
  const s = p.scene;
  const detect = p.detectRate ?? 0;
  const frames = p.framesTotal ?? 0;
  if (!s || frames < 45) return { findings, traces };

  traces.push(
    T("agent_scene", "REASON", `lum=${(s.luminance * 100).toFixed(0)}% con=${(s.contrast * 100).toFixed(0)}% clutter=${(s.clutter * 100).toFixed(0)}% gain=×${s.gain.toFixed(2)} detect=${(detect * 100).toFixed(0)}% over ${frames} frames`, 5)
  );

  if (detect < 0.35) {
    const causes: string[] = [];
    const steps: string[] = [];
    let cat = "LOW_DETECTION_UNKNOWN";
    if (s.luminance < 0.25) {
      cat = "LOW_DETECTION_DARK";
      causes.push(`scene is dark (mean luminance ${(s.luminance * 100).toFixed(0)}%) — the palm detector loses skin/background separation below ~25%`);
      steps.push(`Auto-remediation already applied: brightness gain ×${s.gain.toFixed(2)}, contrast ×${s.contrastGain.toFixed(2)} before inference.`);
      steps.push("Physical fix: add a front light (lamp facing the user), avoid a bright window behind them.");
    }
    if (s.contrast < 0.12) {
      cat = cat === "LOW_DETECTION_UNKNOWN" ? "LOW_DETECTION_FLAT" : cat;
      causes.push(`very low contrast (${(s.contrast * 100).toFixed(0)}%) — flat, washed-out frame; hand edges vanish`);
      steps.push("Increase camera exposure or move the hand in front of a plainer, darker background.");
    }
    if (s.clutter > 0.32) {
      cat = "LOW_DETECTION_CLUTTER";
      causes.push(`cluttered background (edge density ${(s.clutter * 100).toFixed(0)}%) competes with palm proposals`);
      steps.push("Use a plain wall or drape behind the hand; keep other people/hands out of frame.");
      steps.push("Vision-runtime keeps minHandDetectionConfidence at 0.45 and relies on the 9-frame voter to suppress spurious proposals.");
    }
    if (p.intent && p.intent.handScale > 0 && p.intent.handScale < 0.08) {
      causes.push(`hand too small in frame (palm ${(p.intent.handScale * 100).toFixed(1)}% of height) — likely > 1.2 m from camera`);
      steps.push("Bring the hand to 40–80 cm from the camera.");
    }
    if (causes.length === 0) causes.push("scene metrics look nominal; the hand may simply be out of frame or occluded");
    steps.push("Re-check detect-rate on the Controller HUD; target ≥ 80% while the hand is raised.");
    findings.push(
      F("agent_scene", {
        severity: "HIGH",
        category: cat,
        title: `Hand detected in only ${(detect * 100).toFixed(0)}% of frames`,
        symptom: "Recognition drops out; gestures cannot accumulate votes or dwell.",
        rootCause: causes.join("; ") + ".",
        evidence: { scene: s, detectRate: detect, framesTotal: frames, handScale: p.intent?.handScale },
        fixSteps: steps,
        codeHints: ["src/lib/vision-runtime.ts SceneAnalyzer.analyse / frameForDetector", "HandLandmarker minHandDetectionConfidence"],
        affectedModules: ["vision-runtime", "LiveCameraStream"],
        confidence: 0.9,
      })
    );
  } else if (s.preprocessed) {
    findings.push(
      F("agent_scene", {
        severity: "INFO",
        category: "AUTO_GAIN_ACTIVE",
        title: `Low-light auto-gain active (×${s.gain.toFixed(2)}) — detection healthy at ${(detect * 100).toFixed(0)}%`,
        symptom: "Not a defect. Adaptive pre-processing is compensating for the environment.",
        rootCause: `Mean luminance ${(s.luminance * 100).toFixed(0)}% triggered brightness normalisation before inference.`,
        evidence: { scene: s, detectRate: detect },
        fixSteps: ["Nothing required. Improving room lighting will let the pipeline drop the gain and recover contrast detail."],
        codeHints: ["SceneAnalyzer.analyse gains"],
        affectedModules: ["vision-runtime"],
        confidence: 0.95,
      })
    );
  }

  if (s.luminance > 0.82) {
    findings.push(
      F("agent_scene", {
        severity: "MEDIUM",
        category: "OVEREXPOSED",
        title: "Frame is overexposed — highlights clip on skin",
        symptom: `Mean luminance ${(s.luminance * 100).toFixed(0)}%. Finger boundaries wash out; VICTORY↔POINTING confusions rise.`,
        rootCause: "Strong light source facing the camera or auto-exposure locked high.",
        evidence: { scene: s },
        fixSteps: ["Turn the user away from the window / lamp.", "Runtime applies brightness ×0.85; if insufficient, lower camera exposure in OS settings."],
        codeHints: ["SceneAnalyzer gain for mean>0.8"],
        affectedModules: ["vision-runtime"],
        confidence: 0.85,
      })
    );
  }

  traces.push(T("agent_scene", "PRESCRIBE", `SceneRobustness findings=${findings.length}`, Date.now() - t0));
  return { findings, traces };
}

/* ------------------------------------------------------------------ */
/* IntentContinuity                                                     */
/* ------------------------------------------------------------------ */
export function runIntentContinuity(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: Draft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();
  const vis = snap.telemetry.filter((t) => (t.payload as VisionPayload).mode === "WEBCAM").map((t) => t.payload as VisionPayload);
  traces.push(T("agent_intentflow", "OBSERVE", `Analysing ${vis.length} live intent samples + ${snap.recentLogs.length} actuation logs`, 3));
  if (vis.length === 0) {
    traces.push(T("agent_intentflow", "DIAGNOSE", "No live session — intent stream empty", Date.now() - t0));
    return { findings, traces };
  }

  const withHand = vis.filter((v) => v.intent && v.intent.presenceStreakFrames > 0);
  const transitFrac = withHand.length ? withHand.filter((v) => v.intent!.transit).length / withHand.length : 0;
  const unknownFrac = vis.filter((v) => v.vote && v.vote.committed === "UNKNOWN").length / vis.length;
  const lowAgree = vis.filter((v) => v.vote && v.vote.committed !== "UNKNOWN" && v.vote.agreement < 0.7).length;
  const outZone = withHand.filter((v) => v.intent!.reasons.includes("OUT_OF_ZONE")).length;
  const avgScore = withHand.length ? withHand.reduce((s, v) => s + v.intent!.score, 0) / withHand.length : 0;

  traces.push(
    T("agent_intentflow", "REASON", `hand-present samples=${withHand.length} transit=${(transitFrac * 100).toFixed(0)}% unknownVote=${(unknownFrac * 100).toFixed(0)}% lowAgree=${lowAgree} outZone=${outZone} avgIntent=${avgScore.toFixed(2)}`, 5)
  );

  if (withHand.length >= 3 && transitFrac > 0.5) {
    findings.push(
      F("agent_intentflow", {
        severity: "MEDIUM",
        category: "INTENT_TRANSIT_DOMINANT",
        title: "Hand is mostly in transit — user is moving, not commanding",
        symptom: `${(transitFrac * 100).toFixed(0)}% of hand-present samples were flagged HAND_IN_TRANSIT; commands are correctly withheld.`,
        rootCause: "Centroid velocity over 0.8 s exceeds 0.9 units/s. This is deliberate motion (waving, reaching), not a hold. Tremor is already filtered out of this measure.",
        evidence: { transitFrac, samples: withHand.length },
        fixSteps: ["Coach: hold the gesture still for the dwell ring; movement resets intent.", "If the user cannot hold still due to chorea/dystonia, raise the transit threshold per-user (0.9 → 1.3) in IntentTracker."],
        codeHints: ["src/lib/vision-runtime.ts IntentTracker transit threshold"],
        affectedModules: ["vision-runtime"],
        confidence: 0.88,
      })
    );
  }

  if (vis.length >= 4 && unknownFrac > 0.6 && withHand.length / vis.length > 0.6) {
    findings.push(
      F("agent_intentflow", {
        severity: "HIGH",
        category: "VOTE_NEVER_COMMITS",
        title: "Hand is present but the gesture vote rarely commits",
        symptom: `${(unknownFrac * 100).toFixed(0)}% of samples have committed=UNKNOWN despite a tracked hand. The classifier is flickering below the 60% agreement bar.`,
        rootCause: "Per-frame class is unstable: half-curled fingers, hand edge-on to camera, or a pose outside the six trained gestures. Confidence < 0.5 frames are voted UNKNOWN by design.",
        evidence: { unknownFrac, lastClassifier: vis[0].classifier, lastVote: vis[0].vote },
        fixSteps: [
          "Ask the user to face the palm to the camera and fully extend/curl fingers.",
          "Run Personalize for the intended gesture — it multiplies that prototype's score for this user.",
          "If margin stays < 0.1, lower the voter commit fraction 0.6 → 0.5 for enrolled users only.",
        ],
        codeHints: ["GestureVoter(9, 0.6, 0.35)", "classifyHandGesture confidence gate 0.5"],
        affectedModules: ["vision-runtime", "hand-gesture-engine"],
        confidence: 0.87,
      })
    );
  }

  if (outZone >= 3) {
    findings.push(
      F("agent_intentflow", {
        severity: "LOW",
        category: "INTENT_OUT_OF_ZONE",
        title: "Hand repeatedly at the frame edge",
        symptom: `${outZone} samples flagged OUT_OF_ZONE. Landmarks near the border are unreliable and intent is discounted.`,
        rootCause: "Camera framing: hand enters from the side or user is off-centre.",
        evidence: { outZone },
        fixSteps: ["Centre the hand inside the dashed ROI on the Controller.", "Tilt the webcam down slightly if the hand rests on a desk."],
        codeHints: ["IntentTracker inRoi bounds"],
        affectedModules: ["vision-runtime"],
        confidence: 0.85,
      })
    );
  }

  // gesture ↔ device coherence from logs
  const mism = snap.recentLogs.filter((l) => {
    const g = String(l.gesture);
    const id = String(l.applianceId);
    return (g.startsWith("VICTORY") && !id.includes("fan")) || (g.startsWith("POINTING_UP") && !id.includes("ac"));
  });
  if (mism.length >= 2) {
    findings.push(
      F("agent_intentflow", {
        severity: "MEDIUM",
        category: "GESTURE_DEVICE_MISMATCH",
        title: "Gesture semantics disagree with the selected appliance",
        symptom: `${mism.length} commands sent VICTORY/POINTING_UP to a device they don't control.`,
        rootCause: "User selected a device manually while the auto-router expected fan/AC; the intent was probably for the fan/AC.",
        evidence: { samples: mism.slice(0, 4).map((l) => ({ gesture: l.gesture, applianceId: l.applianceId, status: l.status })) },
        fixSteps: ["Keep auto-routing on: VICTORY→fan_table, POINTING_UP→ac_living (page.tsx handleGestureRecognized).", "Show a one-line 'retargeting to Fan' toast when routing switches."],
        codeHints: ["src/app/page.tsx handleGestureRecognized"],
        affectedModules: ["page.tsx"],
        confidence: 0.86,
      })
    );
  }

  if (withHand.length >= 3 && avgScore >= 0.8 && unknownFrac < 0.3) {
    findings.push(
      F("agent_intentflow", {
        severity: "INFO",
        category: "INTENT_HEALTHY",
        title: `Intent stream healthy — avg continuity ${avgScore.toFixed(2)}, committed gestures stable`,
        symptom: "Not a defect.",
        rootCause: "User is holding still, in zone, with consistent gesture votes.",
        evidence: { avgScore, unknownFrac, samples: withHand.length },
        fixSteps: ["None."],
        codeHints: [],
        affectedModules: ["vision-runtime"],
        confidence: 0.9,
      })
    );
  }

  traces.push(T("agent_intentflow", "PRESCRIBE", `IntentContinuity findings=${findings.length}`, Date.now() - t0));
  return { findings, traces };
}

/* ------------------------------------------------------------------ */
/* APIGuard                                                             */
/* ------------------------------------------------------------------ */
export function runApiGuard(snap: AnalysisSnapshot): AgentAnalysisResult {
  const findings: Draft[] = [];
  const traces: AgentTraceStep[] = [];
  const t0 = Date.now();
  traces.push(T("agent_api", "OBSERVE", `Probed ${snap.apiProbes.length} backend routes`, 2));

  for (const pr of snap.apiProbes) {
    if (!pr.ok) {
      findings.push(
        F("agent_api", {
          severity: pr.route.includes("health") || pr.route.includes("actuate") ? "CRITICAL" : "HIGH",
          category: "API_ROUTE_FAILING",
          title: `${pr.method} ${pr.route} → ${pr.status || "network error"}`,
          symptom: `Route returned ${pr.status} in ${pr.latencyMs}ms${pr.error ? ` (${pr.error})` : ""}.`,
          rootCause: pr.status >= 500 ? "Handler threw — see server logs; most often a DB error (missing table after schema change, or DATABASE_URL)." : pr.status === 0 ? "Network/DNS failure reaching own origin — check the ORIGIN derivation in /api/agents." : "Unexpected status; contract drift.",
          evidence: pr as unknown as Record<string, unknown>,
          fixSteps: ["Run: curl -s <origin>" + pr.route, "Check server logs for the stack trace.", "If schema-related: npx drizzle-kit push."],
          codeHints: [`src/app${pr.route}/route.ts`],
          affectedModules: [pr.route],
          confidence: 0.95,
        })
      );
    } else if (pr.bodyOk === false) {
      findings.push(
        F("agent_api", {
          severity: "HIGH",
          category: "API_CONTRACT_DRIFT",
          title: `${pr.route} responded 200 but with an unexpected body shape`,
          symptom: "Frontend expects { success, <collection> }; got something else.",
          rootCause: "Route handler changed its return payload.",
          evidence: pr as unknown as Record<string, unknown>,
          fixSteps: ["Compare the handler's NextResponse.json shape with the fetch consumer in page.tsx."],
          codeHints: [`src/app${pr.route}/route.ts`, "src/app/page.tsx loadData"],
          affectedModules: [pr.route],
          confidence: 0.9,
        })
      );
    } else if (pr.latencyMs > 1500) {
      findings.push(
        F("agent_api", {
          severity: "MEDIUM",
          category: "API_SLOW",
          title: `${pr.route} slow: ${pr.latencyMs}ms`,
          symptom: "UI polling every 30s will feel sluggish; dwell feedback delayed.",
          rootCause: "Unindexed query or cold DB pool.",
          evidence: pr as unknown as Record<string, unknown>,
          fixSteps: ["Add index on created_at for the queried table.", "Limit result set (already ≤100)."],
          codeHints: [`src/app${pr.route}/route.ts`],
          affectedModules: [pr.route],
          confidence: 0.8,
        })
      );
    }
  }

  const r2 = snap.apiProbes.find((p) => p.route.includes("R2-guard"));
  if (r2 && r2.status !== 403) {
    findings.push(
      F("agent_api", {
        severity: "CRITICAL",
        category: "R2_GUARD_REGRESSION",
        title: "R2 guard regression: raw appliances POST no longer returns 403 for heater ON",
        symptom: `Probe expected 403 R2_REQUIRES_INTENT_GATE, got ${r2.status}.`,
        rootCause: "Guard removed or bypassed in /api/appliances POST.",
        evidence: r2 as unknown as Record<string, unknown>,
        fixSteps: ["Restore the riskTier==='R2' && powerState==='ON' && !adminOverride check.", "Re-run council; probe must return 403."],
        codeHints: ["src/app/api/appliances/route.ts"],
        affectedModules: ["appliances API"],
        confidence: 0.99,
      })
    );
  }

  const failing = snap.apiProbes.filter((p) => !p.ok).length;
  traces.push(T("agent_api", "DIAGNOSE", `${snap.apiProbes.length - failing}/${snap.apiProbes.length} routes healthy; avg latency ${Math.round(snap.apiProbes.reduce((s, p) => s + p.latencyMs, 0) / Math.max(1, snap.apiProbes.length))}ms`, Date.now() - t0));
  return { findings, traces };
}
