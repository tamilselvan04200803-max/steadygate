"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import {
  UserProfile,
  SpectrumDataPoint,
  RecognizedGesture,
  HandLandmark2D,
  HandParameters,
} from "@/lib/types";
import { extractMotionSignature, calculateNormalizedStability } from "@/lib/signal-processing";
import {
  classifyHandGesture,
  generateSyntheticGestureLandmarks,
  GESTURE_SMART_HOME_MAP,
} from "@/lib/hand-gesture-engine";
import {
  loadHandLandmarker,
  SceneAnalyzer,
  LandmarkSmoother,
  GestureVoter,
  IntentTracker,
  ErrorCollector,
  makeSessionId,
  postTelemetry,
  HAND_BONES,
  type ModelStatus,
  type Delegate,
  type LoaderEvent,
  type SceneStats,
  type IntentEvidence,
  type VoteResult,
} from "@/lib/vision-runtime";
import {
  Camera,
  Video,
  AlertTriangle,
  Eye,
  Sun,
  ShieldCheck,
  Sliders,
  CheckCircle,
  Wand2,
  Cpu,
  Activity,
} from "lucide-react";

interface LiveCameraStreamProps {
  user: UserProfile | null;
  onTrajectoryUpdate: (data: {
    trajectoryY: number[];
    spectrumPoints: SpectrumDataPoint[];
    currentF0Hz: number;
    currentAmpRms: number;
    stabilityRaw: number;
    stabilityNorm: number;
  }) => void;
  posterior: number;
  setPosterior: (val: number) => void;
  margin: number;
  setMargin: (val: number) => void;
  attention: number;
  setAttention: (val: number) => void;
  sceneQuality: number;
  setSceneQuality: (val: number) => void;
  onGestureRecognized: (gesture: RecognizedGesture, confidence: number, margin: number) => void;
  onPersonalizeSuccess?: (updatedUser: UserProfile) => void;
}

type Runtime = {
  landmarker: HandLandmarker | null;
  delegate: Delegate | null;
  source: "local" | "cdn" | null;
  loaderEvents: LoaderEvent[];
  framesTotal: number;
  framesWithHand: number;
  fpsFrames: number;
  fpsLast: number;
  fps: number;
  lastVideoTime: number;
  lastTelemetry: number;
  lastHandTs: number;
};

export const LiveCameraStream: React.FC<LiveCameraStreamProps> = ({
  user,
  onTrajectoryUpdate,
  posterior,
  setPosterior,
  margin,
  setMargin,
  attention,
  setAttention,
  sceneQuality,
  setSceneQuality,
  onGestureRecognized,
  onPersonalizeSuccess,
}) => {
  const [streamSource, setStreamSource] = useState<"SIMULATED" | "WEBCAM">("SIMULATED");
  const [modelStatus, setModelStatus] = useState<ModelStatus>("IDLE");
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [tremorInjectionAmp, setTremorInjectionAmp] = useState(user?.amplitudeRms || 0.045);
  const [activeGesture, setActiveGesture] = useState<RecognizedGesture>("OPEN_PALM");
  const [handParams, setHandParams] = useState<HandParameters | null>(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [personalizeNotice, setPersonalizeNotice] = useState<string | null>(null);
  const [hud, setHud] = useState<{
    fps: number;
    detectRate: number;
    scene: SceneStats | null;
    vote: VoteResult | null;
    intent: IntentEvidence | null;
    delegate: Delegate | null;
    source: "local" | "cdn" | null;
    handPresent: boolean;
  }>({
    fps: 0,
    detectRate: 0,
    scene: null,
    vote: null,
    intent: null,
    delegate: null,
    source: null,
    handPresent: false,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const trajectoryBufferRef = useRef<number[]>([]);
  const frameCountRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<"SIMULATED" | "WEBCAM">("SIMULATED");
  const rt = useRef<Runtime>({
    landmarker: null,
    delegate: null,
    source: null,
    loaderEvents: [],
    framesTotal: 0,
    framesWithHand: 0,
    fpsFrames: 0,
    fpsLast: 0,
    fps: 0,
    lastVideoTime: -1,
    lastTelemetry: 0,
    lastHandTs: 0,
  });
  const sceneRef = useRef(new SceneAnalyzer());
  const smootherRef = useRef(new LandmarkSmoother());
  const voterRef = useRef(new GestureVoter(9, 0.6, 0.35));
  const intentRef = useRef(new IntentTracker());
  const errorsRef = useRef(new ErrorCollector());
  const sessionRef = useRef<string>("");
  const lastClassRef = useRef<{ gesture: RecognizedGesture; confidence: number; margin: number } | null>(null);
  const lastIntentRef = useRef<IntentEvidence | null>(null);
  const lastVoteRef = useRef<VoteResult | null>(null);
  const cameraErrRef = useRef<string | null>(null);
  const modelStatusRef = useRef<ModelStatus>("IDLE");
  const preferDelegateRef = useRef<Delegate>("GPU");

  useEffect(() => {
    sessionRef.current = makeSessionId();
    errorsRef.current.attach();
  }, []);

  useEffect(() => {
    if (user?.amplitudeRms) setTremorInjectionAmp(user.amplitudeRms);
  }, [user]);

  const setStatus = (s: ModelStatus) => {
    modelStatusRef.current = s;
    setModelStatus(s);
  };

  const sendTelemetry = useCallback(
    async (force = false) => {
      const r = rt.current;
      const now = performance.now();
      if (!force && now - r.lastTelemetry < 3000) return;
      r.lastTelemetry = now;
      const detectRate = r.framesTotal ? r.framesWithHand / r.framesTotal : 0;
      const res = await postTelemetryWithDirectives({
        sessionId: sessionRef.current,
        mode: sourceRef.current,
        modelStatus: modelStatusRef.current,
        delegate: r.delegate,
        modelSource: r.source,
        loaderEvents: r.loaderEvents,
        fps: r.fps,
        framesTotal: r.framesTotal,
        framesWithHand: r.framesWithHand,
        detectRate,
        scene: sceneRef.current.stats(),
        vote: lastVoteRef.current,
        intent: lastIntentRef.current,
        classifier: lastClassRef.current,
        cameraError: cameraErrRef.current,
        jsErrors: errorsRef.current.drain(),
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        ts: Date.now(),
      });
      if (res?.preferDelegate && res.preferDelegate !== preferDelegateRef.current) {
        preferDelegateRef.current = res.preferDelegate as Delegate;
      }
    },
    []
  );

  /* ---------------------------- webcam lifecycle ---------------------------- */

  const startWebcam = async () => {
    setWebcamError(null);
    cameraErrRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error("video element missing");
      v.srcObject = stream;
      await v.play();

      setStatus("LOADING_WASM");
      const r = rt.current;
      r.loaderEvents = [];
      const { landmarker, delegate, source } = await loadHandLandmarker((e) => {
        r.loaderEvents.push(e);
        if (e.stage.startsWith("wasm_") && e.ok) setStatus("LOADING_MODEL");
        if (!e.ok) errorsRef.current.push(`vision loader ${e.stage}: ${e.detail}`, "vision");
      }, preferDelegateRef.current);
      r.landmarker = landmarker;
      r.delegate = delegate;
      r.source = source;
      r.framesTotal = 0;
      r.framesWithHand = 0;
      r.lastVideoTime = -1;
      smootherRef.current.reset();
      voterRef.current.reset();
      intentRef.current.reset();
      setStatus("READY");
      sourceRef.current = "WEBCAM";
      setStreamSource("WEBCAM");
      sendTelemetry(true);
    } catch (err) {
      const e = err as Error;
      const msg =
        e?.name === "NotAllowedError"
          ? "Camera permission denied."
          : e?.name === "NotFoundError"
          ? "No camera device found."
          : `Vision init failed: ${e?.message || String(err)}`;
      cameraErrRef.current = msg;
      setWebcamError(`${msg} Falling back to synthetic hand — this is NOT real recognition.`);
      setStatus("FAILED");
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      sourceRef.current = "SIMULATED";
      setStreamSource("SIMULATED");
      errorsRef.current.push(msg, "camera");
      sendTelemetry(true);
    }
  };

  const stopWebcam = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    rt.current.landmarker?.close();
    rt.current.landmarker = null;
    setStatus("IDLE");
    sourceRef.current = "SIMULATED";
    setStreamSource("SIMULATED");
    sendTelemetry(true);
  };

  useEffect(() => () => stopWebcam(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------ personalize ------------------------------ */

  const handlePersonalizeCurrentGesture = async () => {
    if (!user) return;
    setPersonalizing(true);
    setPersonalizeNotice(null);
    const g =
      sourceRef.current === "WEBCAM" && lastVoteRef.current?.committed !== "UNKNOWN"
        ? lastVoteRef.current?.committed || activeGesture
        : activeGesture;
    try {
      const res = await fetch("/api/personalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          gestureToCalibrate: g,
          palmScale: handParams?.spanRatio || 1.0,
          fingerFlexibility: user.fingerFlexibility || 0.95,
          currentConfidence: posterior,
        }),
      });
      const data = await res.json();
      if (data.success && data.user) {
        setPersonalizeNotice(`✓ Prototype for ${g} adapted to your hand.`);
        onPersonalizeSuccess?.(data.user);
      }
    } catch (err) {
      console.error("Personalize error:", err);
    } finally {
      setPersonalizing(false);
      setTimeout(() => setPersonalizeNotice(null), 4000);
    }
  };

  /* -------------------------------- render loop -------------------------------- */

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    frameCountRef.current += 1;
    const t = frameCountRef.current / 30;
    const now = performance.now();
    const r = rt.current;
    const video = videoRef.current;
    const webcam = sourceRef.current === "WEBCAM" && video && video.readyState >= 2 && r.landmarker;

    ctx.clearRect(0, 0, width, height);

    let normLandmarks: HandLandmark2D[] | null = null;
    let handPresent = false;
    let mirrored = false;

    if (webcam && video) {
      // fps
      r.fpsFrames += 1;
      if (now - r.fpsLast > 1000) {
        r.fps = Math.round((r.fpsFrames * 1000) / (now - r.fpsLast));
        r.fpsFrames = 0;
        r.fpsLast = now;
      }

      // draw mirrored video
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, width, height);
      ctx.restore();
      mirrored = true;

      if (video.currentTime !== r.lastVideoTime) {
        r.lastVideoTime = video.currentTime;
        sceneRef.current.analyse(video);
        const input = sceneRef.current.frameForDetector(video);
        try {
          const res = r.landmarker!.detectForVideo(input, now);
          r.framesTotal += 1;
          const lm = res.landmarks?.[0];
          if (lm && lm.length === 21) {
            r.framesWithHand += 1;
            r.lastHandTs = now;
            const raw: HandLandmark2D[] = lm.map((p) => ({ x: p.x, y: p.y, z: p.z }));
            normLandmarks = smootherRef.current.smooth(raw, now);
            handPresent = true;
          }
        } catch (e) {
          errorsRef.current.push(`detectForVideo: ${(e as Error).message}`, "vision");
        }
      } else if (now - r.lastHandTs < 120 && smootherRef.current) {
        // reuse last smoothed landmarks between video frames (no new frame yet)
        handPresent = false;
      }
    } else {
      // ---- synthetic fallback (clearly labelled) ----
      ctx.fillStyle = sceneQuality < 0.35 ? "#020617" : "#090d16";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
      for (let x = 0; x < width; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      normLandmarks = generateSyntheticGestureLandmarks(
        activeGesture,
        t,
        user?.f0Hz || 5.2,
        tremorInjectionAmp
      );
      handPresent = true;
    }

    // ---------------- classification + intent ----------------
    let classification: ReturnType<typeof classifyHandGesture> | null = null;
    let intent: IntentEvidence;
    let vote: VoteResult | null = null;

    if (normLandmarks) {
      classification = classifyHandGesture(normLandmarks, user);
      setHandParams(classification.handParams);
      intent = webcam ? intentRef.current.update(normLandmarks, now) : {
        presenceStreakFrames: 999,
        wristVelocity: 0,
        inRoi: true,
        handScale: 0.2,
        handScaleOk: true,
        transit: false,
        reasons: [],
        score: 1,
      };
      // Gate noisy frames before voting: low confidence or in-transit → UNKNOWN vote
      const voteGesture: RecognizedGesture =
        classification.confidence < 0.5 || intent.transit ? "UNKNOWN" : classification.gesture;
      vote = voterRef.current.push(voteGesture);
      lastClassRef.current = {
        gesture: classification.gesture,
        confidence: classification.confidence,
        margin: classification.margin,
      };

      // wrist trajectory → FFT signature
      const wristNorm = normLandmarks[0].y - 0.55;
      trajectoryBufferRef.current.push(wristNorm);
      if (trajectoryBufferRef.current.length > 90) trajectoryBufferRef.current.shift();
    } else {
      intent = intentRef.current.noHand();
      vote = voterRef.current.push("UNKNOWN");
      lastClassRef.current = null;
    }
    lastIntentRef.current = intent;
    lastVoteRef.current = vote;

    // every 5 frames: publish measured components upstream
    if (frameCountRef.current % 5 === 0) {
      if (trajectoryBufferRef.current.length >= 45) {
        const sig = extractMotionSignature(trajectoryBufferRef.current, 30, 2.5, 12.0);
        const stability = calculateNormalizedStability(
          sig.spectrumPoints.map((p) => p.magnitude),
          sig.spectrumPoints.map((p) => p.freqHz),
          user?.f0Hz || 5.2,
          user?.amplitudeRms || 0.045
        );
        onTrajectoryUpdate({
          trajectoryY: [...trajectoryBufferRef.current],
          spectrumPoints: sig.spectrumPoints,
          currentF0Hz: sig.f0Hz,
          currentAmpRms: sig.amplitudeRms,
          stabilityRaw: stability.stabilityRaw,
          stabilityNorm: stability.stabilityNorm,
        });
      }

      if (classification && vote) {
        const detectRate = r.framesTotal ? r.framesWithHand / r.framesTotal : 1;
        if (webcam) {
          // MEASURED, not sliders: posterior = classifier conf × vote agreement,
          // margin from classifier, attention from intent continuity, scene from analyser
          const committedConf =
            vote.committed === "UNKNOWN" ? Math.min(classification.confidence, 0.45) : classification.confidence * (0.6 + 0.4 * vote.agreement);
          setPosterior(Math.round(committedConf * 100) / 100);
          setMargin(Math.round(classification.margin * vote.agreement * 100) / 100);
          setAttention(Math.round(intent.score * 100) / 100);
          setSceneQuality(Math.round(sceneRef.current.quality(detectRate) * 100) / 100);
          onGestureRecognized(vote.committed, committedConf, classification.margin);
        } else {
          setPosterior(classification.confidence);
          setMargin(classification.margin);
          onGestureRecognized(classification.gesture, classification.confidence, classification.margin);
        }
        setHud({
          fps: r.fps,
          detectRate,
          scene: sceneRef.current.stats(),
          vote,
          intent,
          delegate: r.delegate,
          source: r.source,
          handPresent,
        });
      } else if (webcam) {
        setPosterior(0.1);
        setMargin(0);
        setAttention(0);
        onGestureRecognized("UNKNOWN", 0.1, 0);
        setHud((h) => ({ ...h, handPresent: false, fps: r.fps, intent, vote, scene: sceneRef.current.stats() }));
      }
      if (webcam) sendTelemetry();
    }

    // ---------------- draw skeleton ----------------
    if (normLandmarks) {
      const px = normLandmarks.map((p) => ({
        x: (mirrored ? 1 - p.x : p.x) * width,
        y: p.y * height,
      }));
      const committed = vote?.committed || "UNKNOWN";
      const color = committed === "UNKNOWN" ? "rgba(148,163,184,0.7)" : "rgba(6,182,212,0.9)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      for (const [a, b] of HAND_BONES) {
        ctx.beginPath();
        ctx.moveTo(px[a].x, px[a].y);
        ctx.lineTo(px[b].x, px[b].y);
        ctx.stroke();
      }
      px.forEach((pt, idx) => {
        const tip = [4, 8, 12, 16, 20].includes(idx);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, idx === 0 ? 6 : tip ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? "#ec4899" : tip ? "#a855f7" : "#06b6d4";
        ctx.fill();
      });

      const center = px[9];
      const label = webcam ? committed : activeGesture;
      const smart = GESTURE_SMART_HOME_MAP[label] || GESTURE_SMART_HOME_MAP.UNKNOWN;
      ctx.fillStyle = "rgba(15,23,42,0.88)";
      ctx.fillRect(center.x - 95, center.y + 90, 190, 34);
      ctx.fillStyle = committed === "UNKNOWN" && webcam ? "#94a3b8" : "#38bdf8";
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${smart.icon} ${label} ${webcam && vote ? `(${Math.round(vote.agreement * 100)}% agree)` : `(${(posterior * 100).toFixed(0)}%)`}`,
        center.x,
        center.y + 104
      );
      ctx.fillStyle = "#94a3b8";
      ctx.font = "9px sans-serif";
      ctx.fillText(`IoT: ${smart.action}`, center.x, center.y + 118);
      ctx.textAlign = "left";
    } else if (webcam) {
      ctx.fillStyle = "rgba(15,23,42,0.75)";
      ctx.fillRect(width / 2 - 140, height / 2 - 18, 280, 36);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No hand detected — raise your hand into the frame", width / 2, height / 2 + 4);
      ctx.textAlign = "left";
    }

    // ROI guide
    ctx.strokeStyle = "rgba(168,85,247,0.35)";
    ctx.setLineDash([5, 6]);
    ctx.strokeRect(width * 0.12, height * 0.1, width * 0.76, height * 0.82);
    ctx.setLineDash([]);

    // footer telemetry
    const s = sceneRef.current.stats();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "10px monospace";
    ctx.fillText(
      webcam
        ? `${r.fps} FPS · ${r.delegate} · lum ${(s.luminance * 100).toFixed(0)}% · con ${(s.contrast * 100).toFixed(0)}% · clutter ${(s.clutter * 100).toFixed(0)}%${s.preprocessed ? ` · gain ×${s.gain.toFixed(2)}` : ""}`
        : `SYNTHETIC HAND — start webcam for real recognition`,
      12,
      height - 12
    );

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [
    sceneQuality,
    user,
    tremorInjectionAmp,
    posterior,
    activeGesture,
    onTrajectoryUpdate,
    onGestureRecognized,
    setPosterior,
    setMargin,
    setAttention,
    setSceneQuality,
    sendTelemetry,
  ]);

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(renderFrame);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [renderFrame]);

  const webcamOn = streamSource === "WEBCAM";

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center space-x-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-100">Real-Time Hand Recognition (MediaPipe)</h3>
        </div>
        <div className="flex items-center space-x-2">
          {webcamOn ? (
            <button
              onClick={stopWebcam}
              className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium"
            >
              Stop Webcam
            </button>
          ) : (
            <button
              onClick={startWebcam}
              disabled={modelStatus === "LOADING_WASM" || modelStatus === "LOADING_MODEL"}
              className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1 disabled:opacity-60"
            >
              <Video className="w-3.5 h-3.5" />
              {modelStatus === "LOADING_WASM"
                ? "Loading WASM…"
                : modelStatus === "LOADING_MODEL"
                ? "Loading model…"
                : "Start Live Webcam"}
            </button>
          )}
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full border font-mono ${
              webcamOn
                ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                : "bg-amber-950 text-amber-300 border-amber-800"
            }`}
          >
            {webcamOn ? `LIVE · ${hud.delegate} · ${hud.source}` : "SYNTHETIC (no camera)"}
          </span>
        </div>
      </div>

      {webcamError && (
        <div className="mb-2 p-2 rounded bg-rose-950/50 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{webcamError}</span>
        </div>
      )}
      {personalizeNotice && (
        <div className="mb-2 p-2 rounded bg-cyan-950/60 border border-cyan-800 text-cyan-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>{personalizeNotice}</span>
        </div>
      )}

      <video ref={videoRef} playsInline muted autoPlay className="absolute w-px h-px opacity-0 pointer-events-none" />

      <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950 aspect-[4/3] max-h-80 flex items-center justify-center">
        <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-contain block" />

        {!webcamOn && (
          <div className="absolute top-2 right-2 flex flex-wrap gap-1 bg-slate-950/90 p-1.5 rounded-lg border border-slate-800 max-w-[60%]">
            {[
              { id: "OPEN_PALM", label: "✋ PALM" },
              { id: "VICTORY", label: "✌️ VICTORY" },
              { id: "POINTING_UP", label: "☝️ POINT" },
              { id: "THUMBS_UP", label: "👍 THUMBS" },
              { id: "FIST", label: "✊ FIST" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveGesture(item.id as RecognizedGesture)}
                className={`px-2 py-1 rounded text-[10px] font-mono ${
                  activeGesture === item.id ? "bg-cyan-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {webcamOn && hud.intent && (
          <div className="absolute top-2 left-2 bg-slate-950/85 px-2.5 py-1.5 rounded-lg border border-slate-800 text-[10px] font-mono space-y-0.5">
            <div className={hud.handPresent ? "text-emerald-400" : "text-amber-400"}>
              hand {hud.handPresent ? "TRACKED" : "LOST"} · detect {Math.round(hud.detectRate * 100)}%
            </div>
            <div className="text-slate-300">
              vote {hud.vote?.committed} · agree {Math.round((hud.vote?.agreement || 0) * 100)}% · stable {hud.vote?.stableFrames}
            </div>
            <div className={hud.intent.reasons.length ? "text-rose-300" : "text-cyan-300"}>
              intent {Math.round(hud.intent.score * 100)}% {hud.intent.reasons.length ? `· ${hud.intent.reasons.join(",")}` : "· CONTINUOUS"}
            </div>
            {hud.scene?.preprocessed && (
              <div className="text-amber-300">low-light gain ×{hud.scene.gain.toFixed(2)} auto-applied</div>
            )}
          </div>
        )}

        <button
          onClick={handlePersonalizeCurrentGesture}
          disabled={personalizing || !user}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/80 text-cyan-300 text-[11px] font-semibold backdrop-blur-md disabled:opacity-50"
        >
          <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
          {personalizing ? "Adapting…" : `Personalize "${webcamOn ? hud.vote?.committed || "…" : activeGesture}"`}
        </button>
      </div>

      {handParams && (
        <div className="mt-3 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Hand Morphology & Extension Ratios
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Span {handParams.spanRatio} · Aspect {handParams.aspectRatio} · Tilt {handParams.tiltAngleDeg}°
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5 text-center font-mono text-[10px]">
            {["Thumb", "Index", "Middle", "Ring", "Pinky"].map((name, idx) => {
              const val = handParams.fingerFlexion[idx];
              const isOpen = val >= 0.55;
              return (
                <div key={name} className="p-1 rounded bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block">{name}</span>
                  <div className="w-full bg-slate-800 rounded-full h-1 my-1 overflow-hidden">
                    <div className={`h-full ${isOpen ? "bg-cyan-400" : "bg-rose-500"}`} style={{ width: `${Math.round(val * 100)}%` }} />
                  </div>
                  <span className={isOpen ? "text-cyan-300 font-bold" : "text-slate-500"}>{isOpen ? "EXT" : "BENT"}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-800/80">
        <Knob
          label="Injected Tremor"
          value={tremorInjectionAmp}
          display={`${(tremorInjectionAmp * 100).toFixed(1)}%`}
          min={0.005}
          max={0.09}
          step={0.005}
          onChange={setTremorInjectionAmp}
          disabled={webcamOn}
          note={webcamOn ? "real hand" : undefined}
          accent="accent-cyan-500"
          icon={<Activity className="w-3 h-3 text-cyan-400" />}
        />
        <Knob
          label="Attention"
          value={attention}
          display={`${(attention * 100).toFixed(0)}%`}
          min={0.2}
          max={1}
          step={0.05}
          onChange={setAttention}
          disabled={webcamOn}
          note={webcamOn ? "measured" : undefined}
          accent="accent-blue-500"
          icon={<Eye className="w-3 h-3 text-blue-400" />}
        />
        <Knob
          label="Scene / Light"
          value={sceneQuality}
          display={`${(sceneQuality * 100).toFixed(0)}%`}
          min={0.1}
          max={1}
          step={0.05}
          onChange={setSceneQuality}
          disabled={webcamOn}
          note={webcamOn ? "measured" : undefined}
          accent="accent-amber-500"
          icon={<Sun className="w-3 h-3 text-amber-400" />}
        />
        <Knob
          label="Confidence"
          value={posterior}
          display={`${(posterior * 100).toFixed(0)}%`}
          min={0.1}
          max={1}
          step={0.02}
          onChange={setPosterior}
          disabled={webcamOn}
          note={webcamOn ? "measured" : undefined}
          accent="accent-emerald-500"
          icon={<ShieldCheck className="w-3 h-3 text-emerald-400" />}
        />
      </div>
      {webcamOn && (
        <p className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
          <Cpu className="w-3 h-3" />
          In webcam mode, confidence / attention / scene are measured from the pipeline and cannot be edited.
        </p>
      )}
    </div>
  );
};

function Knob(props: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  note?: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`p-2 rounded bg-slate-950/60 border border-slate-800 ${props.disabled ? "opacity-70" : ""}`}>
      <div className="flex justify-between text-[11px] text-slate-300 mb-1">
        <span className="flex items-center gap-1">
          {props.icon}
          {props.label}
          {props.note && <span className="text-[9px] text-slate-500">({props.note})</span>}
        </span>
        <span className="font-mono text-slate-200">{props.display}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        className={`w-full ${props.accent} h-1 cursor-pointer disabled:cursor-not-allowed`}
        aria-label={props.label}
      />
    </div>
  );
}

async function postTelemetryWithDirectives(
  t: Parameters<typeof postTelemetry>[0]
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: t.sessionId, source: "vision", payload: t }),
      keepalive: true,
    });
    const data = await res.json();
    return data?.directives || null;
  } catch {
    return null;
  }
}
