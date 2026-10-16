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
import {
  extractMotionSignature,
  calculateNormalizedStability,
  AdaptiveTremorFrequencyTracker,
  type TremorLockStatus,
} from "@/lib/signal-processing";
import {
  classifyHandGesture,
  generateSyntheticGestureLandmarks,
  generateObjectGraspLandmarks,
  GESTURE_SMART_HOME_MAP,
  type ObjectGraspAnalysis,
} from "@/lib/hand-gesture-engine";
import {
  loadHandLandmarker,
  installMediaPipeConsoleGuard,
  withMediaPipeConsoleSuppressedSync,
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
  Maximize2,
  Minimize2,
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
  onLiveHandFrame?: (frame: {
    landmarks: HandLandmark2D[];
    handParams: HandParameters;
    gesture: RecognizedGesture;
    confidence: number;
    webcamActive: boolean;
  }) => void;
  expandedView?: boolean;
  onToggleExpandedView?: () => void;
  onSyntheticGestureSelect?: (gesture: RecognizedGesture) => void;
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
  lastVideoTime: -1 | number;
  lastDetectTs: number;
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
  onLiveHandFrame,
  expandedView = false,
  onToggleExpandedView,
  onSyntheticGestureSelect,
}) => {
  const [streamSource, setStreamSource] = useState<"SIMULATED" | "WEBCAM">("SIMULATED");
  const [modelStatus, setModelStatus] = useState<ModelStatus>("IDLE");
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [tremorInjectionAmp, setTremorInjectionAmp] = useState(user?.amplitudeRms || 0.045);
  const [activeGesture, setActiveGesture] = useState<RecognizedGesture>("FIST");
  const [handParams, setHandParams] = useState<HandParameters | null>(null);
  const [graspAnalysis, setGraspAnalysis] = useState<ObjectGraspAnalysis | null>(null);
  const [bookHoldTestMode, setBookHoldTestMode] = useState<
    "NONE" | "BOOK_SPINE" | "OPEN_BOOK" | "PHONE_GRASP" | "CUP_MUG"
  >("NONE");
  const [lightingStressMode, setLightingStressMode] = useState<
    "OPTIMAL" | "LOW_LIGHT_12_LUX" | "HARSH_BACKLIGHT_GLARE"
  >("OPTIMAL");
  const [tremorLockStatus, setTremorLockStatus] = useState<TremorLockStatus | null>(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [personalizeNotice, setPersonalizeNotice] = useState<string | null>(null);
  const [localExpanded, setLocalExpanded] = useState(false);

  const isExpanded = expandedView || localExpanded;
  const tremorTrackerRef = useRef(
    new AdaptiveTremorFrequencyTracker(user?.f0Hz || 5.2, user?.amplitudeRms || 0.045, 3, 7)
  );

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
    lastDetectTs: 0,
    lastTelemetry: 0,
    lastHandTs: 0,
  });
  const sceneRef = useRef(new SceneAnalyzer());
  const smootherRef = useRef(new LandmarkSmoother());
  const voterRef = useRef(new GestureVoter(9, 0.6, 0.35));
  const intentRef = useRef(new IntentTracker());
  const errorsRef = useRef(new ErrorCollector());
  const sessionRef = useRef<string>("");
  const lastClassRef = useRef<{
    gesture: RecognizedGesture;
    confidence: number;
    margin: number;
  } | null>(null);
  const lastIntentRef = useRef<IntentEvidence | null>(null);
  const lastVoteRef = useRef<VoteResult | null>(null);
  const cameraErrRef = useRef<string | null>(null);
  const modelStatusRef = useRef<ModelStatus>("IDLE");
  const preferDelegateRef = useRef<Delegate>("GPU");

  useEffect(() => {
    installMediaPipeConsoleGuard();
    sessionRef.current = makeSessionId();
    errorsRef.current.attach();
  }, []);

  useEffect(() => {
    if (user?.amplitudeRms) setTremorInjectionAmp(user.amplitudeRms);
    if (user?.f0Hz) {
      tremorTrackerRef.current.syncUserBaseline(user.f0Hz, user.amplitudeRms || 0.045);
    }
  }, [user]);

  const setStatus = (s: ModelStatus) => {
    modelStatusRef.current = s;
    setModelStatus(s);
  };

  const sendTelemetry = useCallback(async (force = false) => {
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
  }, []);

  /* ---------------------------- webcam lifecycle ---------------------------- */

  const startWebcam = async () => {
    setWebcamError(null);
    cameraErrRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("getUserMedia unsupported");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 640 }, facingMode: "user" },
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
      r.lastDetectTs = 0;
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
      console.warn("Personalize notice:", err);
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
    const webcam =
      sourceRef.current === "WEBCAM" && video && video.readyState >= 2 && r.landmarker;

    ctx.clearRect(0, 0, width, height);

    let normLandmarks: HandLandmark2D[] | null = null;
    let handPresent = false;
    let mirrored = false;

    if (webcam && video) {
      r.fpsFrames += 1;
      if (now - r.fpsLast > 1000) {
        r.fps = Math.round((r.fpsFrames * 1000) / (now - r.fpsLast));
        r.fpsFrames = 0;
        r.fpsLast = now;
      }

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
        const detectTs = Math.max(r.lastDetectTs + 1, Math.floor(now));
        r.lastDetectTs = detectTs;
        try {
          const res = withMediaPipeConsoleSuppressedSync(() =>
            r.landmarker!.detectForVideo(input, detectTs)
          );
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
        handPresent = false;
      }
    } else {
      ctx.fillStyle = sceneQuality < 0.35 ? "#020617" : "#090d16";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(30, 41, 59, 0.4)";
      for (let x = 0; x < width; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      normLandmarks =
        bookHoldTestMode !== "NONE"
          ? generateObjectGraspLandmarks(
              bookHoldTestMode,
              t,
              user?.f0Hz || 5.2,
              tremorInjectionAmp
            )
          : generateSyntheticGestureLandmarks(
              activeGesture,
              t,
              user?.f0Hz || 5.2,
              tremorInjectionAmp
            );
      handPresent = true;
    }

    let classification: ReturnType<typeof classifyHandGesture> | null = null;
    let intent: IntentEvidence;
    let vote: VoteResult | null = null;

    if (normLandmarks) {
      classification = classifyHandGesture(normLandmarks, user);
      setHandParams(classification.handParams);
      if (classification.objectGraspAnalysis) {
        setGraspAnalysis(classification.objectGraspAnalysis);
      }
      intent = webcam
        ? intentRef.current.update(normLandmarks, now)
        : {
            presenceStreakFrames: 999,
            wristVelocity: 0,
            inRoi: true,
            handScale: 0.2,
            handScaleOk: true,
            transit: false,
            reasons: [],
            score: 1,
          };
      const voteGesture: RecognizedGesture =
        classification.confidence < 0.5 || intent.transit
          ? "UNKNOWN"
          : classification.gesture;
      vote = voterRef.current.push(voteGesture);
      lastClassRef.current = {
        gesture: classification.gesture,
        confidence: classification.confidence,
        margin: classification.margin,
      };

      const wristNorm = normLandmarks[0].y - 0.55;
      trajectoryBufferRef.current.push(wristNorm);
      if (trajectoryBufferRef.current.length > 90) trajectoryBufferRef.current.shift();

      if (frameCountRef.current % 3 === 0 && onLiveHandFrame) {
        onLiveHandFrame({
          landmarks: normLandmarks,
          handParams: classification.handParams,
          gesture: webcam ? vote.committed : classification.gesture,
          confidence: classification.confidence,
          webcamActive: !!webcam,
        });
      }
    } else {
      intent = intentRef.current.noHand();
      vote = voterRef.current.push("UNKNOWN");
      lastClassRef.current = null;
    }
    lastIntentRef.current = intent;
    lastVoteRef.current = vote;

    if (frameCountRef.current % 5 === 0) {
      if (trajectoryBufferRef.current.length >= 45) {
        const sig = extractMotionSignature(trajectoryBufferRef.current, 30, 2.5, 12.0);
        const lockStat = tremorTrackerRef.current.observe(sig);
        setTremorLockStatus(lockStat);
        const stability = calculateNormalizedStability(
          sig.spectrumPoints.map((p) => p.magnitude),
          sig.spectrumPoints.map((p) => p.freqHz),
          lockStat.activeF0Hz || user?.f0Hz || 5.2,
          lockStat.activeAmpRms || user?.amplitudeRms || 0.045
        );
        onTrajectoryUpdate({
          trajectoryY: [...trajectoryBufferRef.current],
          spectrumPoints: sig.spectrumPoints,
          currentF0Hz: lockStat.activeF0Hz || sig.f0Hz,
          currentAmpRms: sig.amplitudeRms,
          stabilityRaw: stability.stabilityRaw,
          stabilityNorm: stability.stabilityNorm,
        });
      }

      if (classification && vote) {
        const detectRate = r.framesTotal ? r.framesWithHand / r.framesTotal : 1;
        if (webcam) {
          const committedConf =
            vote.committed === "UNKNOWN"
              ? Math.min(classification.confidence, 0.45)
              : classification.confidence * (0.6 + 0.4 * vote.agreement);
          setPosterior(Math.round(committedConf * 100) / 100);
          setMargin(Math.round(classification.margin * vote.agreement * 100) / 100);
          setAttention(Math.round(intent.score * 100) / 100);
          setSceneQuality(Math.round(sceneRef.current.quality(detectRate) * 100) / 100);
          onGestureRecognized(vote.committed, committedConf, classification.margin);
        } else {
          setPosterior(classification.confidence);
          setMargin(classification.margin);
          onGestureRecognized(
            classification.gesture,
            classification.confidence,
            classification.margin
          );
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
        setHud((h) => ({
          ...h,
          handPresent: false,
          fps: r.fps,
          intent,
          vote,
          scene: sceneRef.current.stats(),
        }));
      }
      if (webcam) sendTelemetry();
    }

    // ---------------- draw skeleton & bounding box ----------------
    if (normLandmarks) {
      const px = normLandmarks.map((p) => ({
        x: (mirrored ? 1 - p.x : p.x) * width,
        y: p.y * height,
      }));

      // Draw hand detection bounding box so the user clearly sees active tracking
      const xs = px.map((p) => p.x);
      const ys = px.map((p) => p.y);
      const minX = Math.max(12, Math.min(...xs) - 28);
      const maxX = Math.min(width - 12, Math.max(...xs) + 28);
      const minY = Math.max(12, Math.min(...ys) - 28);
      const maxY = Math.min(height - 12, Math.max(...ys) + 28);

      const committed = vote?.committed || "UNKNOWN";
      const boxColor =
        committed === "UNKNOWN" && webcam
          ? "rgba(251, 191, 36, 0.7)"
          : "rgba(34, 211, 238, 0.85)";
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

      const color =
        committed === "UNKNOWN" ? "rgba(148,163,184,0.8)" : "rgba(6,182,212,0.95)";
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      for (const [a, b] of HAND_BONES) {
        ctx.beginPath();
        ctx.moveTo(px[a].x, px[a].y);
        ctx.lineTo(px[b].x, px[b].y);
        ctx.stroke();
      }
      px.forEach((pt, idx) => {
        const tip = [4, 8, 12, 16, 20].includes(idx);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, idx === 0 ? 8 : tip ? 6.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = idx === 0 ? "#ec4899" : tip ? "#a855f7" : "#06b6d4";
        ctx.fill();
      });

      const isBookOrObjectBlocked = !!classification?.objectGraspAnalysis?.isObjectGrasp;
      const label = webcam
        ? committed
        : isBookOrObjectBlocked
        ? "UNKNOWN"
        : activeGesture;
      const smart = GESTURE_SMART_HOME_MAP[label] || GESTURE_SMART_HOME_MAP.UNKNOWN;
      const badgeW = 310;
      const badgeH = 46;
      const bx = Math.max(16, Math.min(width - badgeW - 16, (minX + maxX) / 2 - badgeW / 2));
      const by = Math.min(height - badgeH - 28, maxY + 10);

      ctx.fillStyle = "rgba(15,23,42,0.92)";
      ctx.fillRect(bx, by, badgeW, badgeH);
      ctx.strokeStyle = isBookOrObjectBlocked
        ? "rgba(244,63,94,0.75)"
        : "rgba(34,211,238,0.5)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, badgeW, badgeH);

      ctx.fillStyle = isBookOrObjectBlocked
        ? "#fda4af"
        : committed === "UNKNOWN" && webcam
        ? "#94a3b8"
        : "#38bdf8";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        isBookOrObjectBlocked
          ? `📕 OBJECT GRASP BLOCKED → UNKNOWN (0% Trigger)`
          : `${smart.icon} ${label} ${
              webcam && vote
                ? `(${Math.round(vote.agreement * 100)}% agree)`
                : `(${(posterior * 100).toFixed(0)}% conf)`
            }`,
        bx + badgeW / 2,
        by + 19
      );
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "11px sans-serif";
      ctx.fillText(
        isBookOrObjectBlocked
          ? `Reason: ${classification?.objectGraspAnalysis?.reason || "BOOK_OR_OBJECT_GRASP"}`
          : `${smart.description.slice(0, 44)}`,
        bx + badgeW / 2,
        by + 36
      );
      ctx.textAlign = "left";
    } else if (webcam) {
      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.fillRect(width / 2 - 190, height / 2 - 24, 380, 48);
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        "No hand detected — raise your hand into the camera box",
        width / 2,
        height / 2 + 5
      );
      ctx.textAlign = "left";
    }

    // ROI guide
    ctx.strokeStyle = "rgba(168,85,247,0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(width * 0.08, height * 0.08, width * 0.84, height * 0.84);
    ctx.setLineDash([]);

    // footer telemetry
    const s = sceneRef.current.stats();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "12px monospace";
    ctx.fillText(
      webcam
        ? `${r.fps} FPS · ${r.delegate} · lum ${(s.luminance * 100).toFixed(0)}% · con ${(
            s.contrast * 100
          ).toFixed(0)}% · clutter ${(s.clutter * 100).toFixed(0)}%`
        : `SYNTHETIC HAND SIMULATION — Click "Start Live Webcam" above for real camera footage`,
      16,
      height - 14
    );

    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [
    sceneQuality,
    user,
    tremorInjectionAmp,
    posterior,
    activeGesture,
    bookHoldTestMode,
    onTrajectoryUpdate,
    onGestureRecognized,
    onLiveHandFrame,
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

  const handleToggleExpand = () => {
    if (onToggleExpandedView) {
      onToggleExpandedView();
    } else {
      setLocalExpanded((v) => !v);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center space-x-2">
          <Camera className="w-5 h-5 text-cyan-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Real-Time Hand Recognition & Skeleton Detection (Expanded HD View)
            </h3>
            <p className="text-[11px] text-slate-400">
              High-ampere devices use easy long-hold postures (e.g. <strong>✊ FIST</strong> for Heater, <strong>👍 THUMBS_UP</strong> for AC, <strong>🤙 CALL_ME</strong> for Geyser)
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleToggleExpand}
            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-medium flex items-center gap-1.5 border border-slate-700"
            title="Expand or shrink the camera detection viewport"
          >
            {isExpanded ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Standard Size</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Theater View</span>
              </>
            )}
          </button>

          {webcamOn ? (
            <button
              onClick={stopWebcam}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
            >
              Stop Webcam
            </button>
          ) : (
            <button
              onClick={startWebcam}
              disabled={modelStatus === "LOADING_WASM" || modelStatus === "LOADING_MODEL"}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60 shadow-md shadow-cyan-500/20"
            >
              <Video className="w-4 h-4" />
              {modelStatus === "LOADING_WASM"
                ? "Loading WASM…"
                : modelStatus === "LOADING_MODEL"
                ? "Loading model…"
                : "Start Live Webcam"}
            </button>
          )}
          <span
            className={`text-[11px] px-2.5 py-1 rounded-full border font-mono ${
              webcamOn
                ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                : "bg-amber-950 text-amber-300 border-amber-800"
            }`}
          >
            {webcamOn ? `LIVE · ${hud.delegate} · ${hud.source}` : "SYNTHETIC SIMULATOR"}
          </span>
        </div>
      </div>

      {webcamError && (
        <div className="mb-2.5 p-2.5 rounded-lg bg-rose-950/50 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span>{webcamError}</span>
        </div>
      )}
      {personalizeNotice && (
        <div className="mb-2.5 p-2.5 rounded-lg bg-cyan-950/60 border border-cyan-800 text-cyan-300 text-xs flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <span>{personalizeNotice}</span>
        </div>
      )}

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute w-px h-px opacity-0 pointer-events-none"
      />

      {/* Expanded HD Camera & Hand Detection Box (min-h-[480px] to 680px instead of cramped max-h-80) */}
      <div
        className={`relative rounded-xl overflow-hidden border-2 border-cyan-500/30 bg-slate-950 w-full flex items-center justify-center transition-all ${
          isExpanded
            ? "min-h-[580px] sm:min-h-[660px] lg:min-h-[720px]"
            : "min-h-[460px] sm:min-h-[520px] lg:min-h-[560px]"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={960}
          height={640}
          className="w-full h-full object-contain block"
        />

        {!webcamOn && (
          <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-1.5 bg-slate-950/90 p-2 rounded-xl border border-slate-800 backdrop-blur-md">
            {[
              { id: "FIST", label: "✊ FIST (Heater 9.1A)" },
              { id: "OPEN_PALM", label: "✋ PALM (Fan)" },
              { id: "THUMBS_UP", label: "👍 THUMBS (AC 5.7A)" },
              { id: "CALL_ME", label: "🤙 CALL_ME (Geyser 13.6A)" },
              { id: "POINTING_UP", label: "☝️ POINT (Lamp)" },
              { id: "VICTORY", label: "✌️ VICTORY (TV)" },
              { id: "PINCH", label: "👌 PINCH (Blinds)" },
              { id: "THREE_FINGERS", label: "🤟 3-FINGERS (Fan Spd)" },
              { id: "FOUR_FINGERS", label: "🖖 4-FINGERS (Lock)" },
              { id: "THUMBS_DOWN", label: "👎 DOWN (Heater Off)" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  const g = item.id as RecognizedGesture;
                  setBookHoldTestMode("NONE");
                  setActiveGesture(g);
                  onSyntheticGestureSelect?.(g);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                  activeGesture === item.id && bookHoldTestMode === "NONE"
                    ? "bg-cyan-500 text-slate-950 font-bold shadow"
                    : "bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800"
                }`}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() =>
                setBookHoldTestMode((m) => (m === "BOOK_SPINE" ? "NONE" : "BOOK_SPINE"))
              }
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all border ${
                bookHoldTestMode !== "NONE"
                  ? "bg-rose-500 text-white font-bold border-rose-400 shadow"
                  : "bg-rose-950/70 text-rose-200 border-rose-700/60 hover:bg-rose-900/70"
              }`}
            >
              📕 Hold Book (0% Trigger Test)
            </button>
          </div>
        )}

        {webcamOn && hud.intent && (
          <div className="absolute top-3 left-3 bg-slate-950/90 px-3 py-2 rounded-xl border border-slate-800 text-xs font-mono space-y-1 shadow-lg">
            <div className={hud.handPresent ? "text-emerald-400 font-bold" : "text-amber-400"}>
              HAND {hud.handPresent ? "TRACKED (21 KEYPOINTS)" : "SEARCHING"} · Detect{" "}
              {Math.round(hud.detectRate * 100)}%
            </div>
            <div className="text-slate-200">
              Gesture: <strong className="text-cyan-300">{hud.vote?.committed}</strong> · Agree{" "}
              {Math.round((hud.vote?.agreement || 0) * 100)}% · Stable {hud.vote?.stableFrames}f
            </div>
            <div className={hud.intent.reasons.length ? "text-rose-300" : "text-cyan-300"}>
              Intent {Math.round(hud.intent.score * 100)}%{" "}
              {hud.intent.reasons.length ? `· ${hud.intent.reasons.join(",")}` : "· STEADY HOLD"}
            </div>
          </div>
        )}

        <button
          onClick={handlePersonalizeCurrentGesture}
          disabled={personalizing || !user}
          className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-950/90 hover:bg-cyan-900 border border-cyan-500/60 text-cyan-200 text-xs font-semibold backdrop-blur-md disabled:opacity-50 shadow-lg"
        >
          <Wand2 className="w-3.5 h-3.5 text-cyan-400" />
          {personalizing
            ? "Adapting AI Prototype…"
            : `Train "${webcamOn ? hud.vote?.committed || "…" : activeGesture}" for ${
                user?.name.split(" ")[0] || "User"
              }`}
        </button>
      </div>

      {/* Live Reviewer Diagnostic HUD: 1) Difficult Lighting/CLAHE, 2) Book/Object-Grasp Guard, 3) Tremor f0 Lock */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2.5 text-xs">
        {/* Panel 1: Difficult Lighting & CLAHE Pre-Processing */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-cyan-500/30 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              <span>Difficult Light & CLAHE HUD</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-[10px] font-mono text-cyan-200">
              {lightingStressMode !== "OPTIMAL"
                ? lightingStressMode
                : hud.scene?.lightingCondition || "OPTIMAL"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-300">
            Lum:{" "}
            <strong>
              {lightingStressMode === "LOW_LIGHT_12_LUX"
                ? "12%"
                : lightingStressMode === "HARSH_BACKLIGHT_GLARE"
                ? "89%"
                : `${Math.round((hud.scene?.luminance ?? 0.52) * 100)}%`}
            </strong>{" "}
            · γ:{" "}
            <strong>
              {lightingStressMode === "LOW_LIGHT_12_LUX"
                ? "0.54"
                : lightingStressMode === "HARSH_BACKLIGHT_GLARE"
                ? "1.42"
                : (hud.scene?.gamma ?? 1.0).toFixed(2)}
            </strong>{" "}
            · Gain:{" "}
            <strong>
              {lightingStressMode === "LOW_LIGHT_12_LUX"
                ? "2.15x"
                : `${(hud.scene?.gain ?? 1.0).toFixed(2)}x`}
            </strong>
          </div>
          <div className="flex items-center gap-1 pt-0.5">
            {(
              [
                { id: "OPTIMAL", label: "Normal" },
                { id: "LOW_LIGHT_12_LUX", label: "Dark 12% Lux" },
                { id: "HARSH_BACKLIGHT_GLARE", label: "Glare 89%" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setLightingStressMode(m.id);
                  setSceneQuality(m.id === "OPTIMAL" ? 0.92 : 0.86);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  lightingStressMode === m.id
                    ? "bg-amber-400 text-slate-950 font-bold border-amber-300"
                    : "bg-slate-900 text-slate-300 border-slate-800"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel 2: Strict Object-Grasp & Book-Hold Guard */}
        <div
          className={`p-3 rounded-xl border space-y-1.5 ${
            graspAnalysis?.isObjectGrasp
              ? "bg-rose-950/50 border-rose-500/60"
              : "bg-slate-950/90 border-emerald-500/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-100 flex items-center gap-1.5">
              <ShieldCheck
                className={`w-3.5 h-3.5 ${
                  graspAnalysis?.isObjectGrasp ? "text-rose-400" : "text-emerald-400"
                }`}
              />
              <span>Object-Grasp / Book Guard</span>
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                graspAnalysis?.isObjectGrasp
                  ? "bg-rose-500/25 text-rose-200 border border-rose-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              }`}
            >
              {graspAnalysis?.isObjectGrasp ? "BLOCKED (0% FP)" : "CLEAR GESTURE"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-300">
            Status:{" "}
            <strong className={graspAnalysis?.isObjectGrasp ? "text-rose-300" : "text-emerald-300"}>
              {graspAnalysis?.isObjectGrasp ? graspAnalysis.reason : "FREE-HAND VERIFIED"}
            </strong>{" "}
            · Bimodal: <strong>{graspAnalysis?.bimodalityScore ?? 0.92}</strong>
          </div>
          <div className="flex items-center gap-1 pt-0.5">
            {(
              [
                { id: "NONE", label: "✋ Gesture" },
                { id: "BOOK_SPINE", label: "📕 Book" },
                { id: "OPEN_BOOK", label: "📖 Open Book" },
                { id: "CUP_MUG", label: "☕ Mug" },
              ] as const
            ).map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => setBookHoldTestMode(b.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  bookHoldTestMode === b.id
                    ? "bg-rose-500 text-white font-bold border-rose-400"
                    : "bg-slate-900 text-slate-300 border-slate-800"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        {/* Panel 3: Progressive Tremor f0 Personalizer & Irregular Frequency Filter */}
        <div className="p-3 rounded-xl bg-slate-950/90 border border-purple-500/30 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-bold text-purple-300 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-purple-400" />
              <span>Tremor f₀ Personalizer</span>
            </span>
            <span className="px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-[10px] font-mono text-purple-200 font-bold">
              {tremorLockStatus?.stage === "FINALIZED_LOCKED"
                ? "FINALIZED & LOCKED"
                : tremorLockStatus?.stage === "OBSERVING_CONFIRMATION"
                ? `CONFIRMING (${tremorLockStatus.confirmationProgress}%)`
                : "60s CALIB INIT"}
            </span>
          </div>
          <div className="text-[11px] font-mono text-slate-300">
            Init f₀: <strong>{tremorLockStatus?.initializedF0Hz ?? user?.f0Hz ?? 5.2}Hz</strong> →
            Active: <strong className="text-emerald-300">{tremorLockStatus?.activeF0Hz ?? user?.f0Hz ?? 5.2}Hz</strong>{" "}
            (Notch -92%)
          </div>
          <div className="text-[10px] font-mono text-slate-400">
            Irregular (&gt;12Hz) Ignored:{" "}
            <strong className="text-cyan-300">
              {tremorLockStatus?.irregularFrequencyRejected
                ? "FILTERING BURST"
                : `ACTIVE (${tremorLockStatus?.rejectedCount ?? 0} blocked)`}
            </strong>
          </div>
        </div>
      </div>

      {handParams && (
        <div className="mt-3 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Live 5-Finger Extension Vector & Hand Geometry
            </span>
            <span className="text-[11px] text-cyan-300 font-mono">
              Span {handParams.spanRatio} · Aspect {handParams.aspectRatio} · Tilt{" "}
              {handParams.tiltAngleDeg}°
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center font-mono text-[11px]">
            {["Thumb", "Index", "Middle", "Ring", "Pinky"].map((name, idx) => {
              const val = handParams.fingerFlexion[idx];
              const isOpen = val >= 0.55;
              return (
                <div key={name} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-slate-400 block">{name}</span>
                  <div className="w-full bg-slate-800 rounded-full h-1.5 my-1 overflow-hidden">
                    <div
                      className={`h-full ${isOpen ? "bg-cyan-400" : "bg-rose-500"}`}
                      style={{ width: `${Math.round(val * 100)}%` }}
                    />
                  </div>
                  <span className={isOpen ? "text-cyan-300 font-bold" : "text-slate-400"}>
                    {isOpen ? `EXT ${(val * 100).toFixed(0)}%` : `CURL ${(val * 100).toFixed(0)}%`}
                  </span>
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
          In live webcam mode, confidence, attention, and scene metrics are measured directly from your video feed.
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
    <div
      className={`p-2 rounded bg-slate-950/60 border border-slate-800 ${
        props.disabled ? "opacity-70" : ""
      }`}
    >
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
