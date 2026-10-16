"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { UserProfile, HandLandmark2D, RecognizedGesture } from "@/lib/types";
import {
  classifyHandGesture,
  generateSyntheticGestureLandmarks,
} from "@/lib/hand-gesture-engine";
import { loadHandLandmarker, HAND_BONES } from "@/lib/vision-runtime";
import {
  UserPlus,
  Activity,
  CheckCircle2,
  X,
  Sparkles,
  Sliders,
  Hand,
  FileText,
  Clock,
  Video,
  Camera,
  Cpu,
} from "lucide-react";

interface EnrolmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileCreated: (profile: UserProfile) => void;
  liveTrajectoryY?: number[];
  liveHandParams?: {
    palmScale: number;
    fingerSpread: number;
    fingerExtensions: [number, number, number, number, number];
    wristAngleDeg: number;
  } | null;
  liveGesture?: string;
  liveTremorHz?: number;
  liveTremorAmp?: number;
  liveStability?: number;
}

const ENROLMENT_DURATION_SEC = 60;
const SAMPLE_RATE_HZ = 30;

interface EnrolmentPhaseInfo {
  stage: number;
  rangeLabel: string;
  title: string;
  targetGesture: RecognizedGesture;
  icon: string;
  instruction: string;
}

const ENROLMENT_PHASES: EnrolmentPhaseInfo[] = [
  {
    stage: 1,
    rangeLabel: "0s – 15s",
    title: "Closed Fist Hold (High-Ampere Heater Posture)",
    targetGesture: "FIST",
    icon: "✊",
    instruction:
      "Show a CLOSED FIST (✊) in the live camera frame so the AI model learns your resting grasp and tremor baseline.",
  },
  {
    stage: 2,
    rangeLabel: "15s – 30s",
    title: "Open Palm Span (Fan & Baseline Span)",
    targetGesture: "OPEN_PALM",
    icon: "✋",
    instruction:
      "Open your hand into an OPEN PALM (✋) so the AI model measures your palm scale and 5-finger extension span.",
  },
  {
    stage: 3,
    rangeLabel: "30s – 45s",
    title: "Thumbs Up & Call-Me (High-Ampere AC & Geyser Postures)",
    targetGesture: "THUMBS_UP",
    icon: "👍",
    instruction:
      "Show THUMBS UP (👍) or CALL-ME (🤙) so the AI model calibrates your thumb abduction angle.",
  },
  {
    stage: 4,
    rangeLabel: "45s – 60s",
    title: "Pointing Up & Victory (Quick Appliance Postures)",
    targetGesture: "POINTING_UP",
    icon: "☝️",
    instruction:
      "Extend your index finger (☝️ POINTING_UP or ✌️ VICTORY) to complete per-finger AI prototype training.",
  },
];

export const EnrolmentModal: React.FC<EnrolmentModalProps> = ({
  isOpen,
  onClose,
  onProfileCreated,
  liveTrajectoryY = [],
  liveHandParams = null,
  liveGesture = "FIST",
  liveTremorHz = 5.4,
  liveTremorAmp = 0.018,
  liveStability = 0.88,
}) => {
  const [name, setName] = useState("Personalized User (Live AI Model)");
  const [condition, setCondition] = useState("Live Camera Hand & Tremor AI Personalization");
  const [medicationState, setMedicationState] = useState<"ON" | "OFF" | "UNKNOWN">("ON");
  const [simulatedFreq, setSimulatedFreq] = useState(5.4);
  const [simulatedAmp, setSimulatedAmp] = useState(0.022);

  const [step, setStep] = useState<"SETUP" | "RECORDING" | "PROCESSING" | "COMPLETE">("SETUP");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [progress, setProgress] = useState(0);
  const [samplesCollected, setSamplesCollected] = useState(0);
  const [landmarkFramesCount, setLandmarkFramesCount] = useState(0);
  const [cameraModeUsed, setCameraModeUsed] = useState<"LIVE_WEBCAM" | "SYNTHETIC_FALLBACK">(
    "LIVE_WEBCAM"
  );
  const [cameraStatusText, setCameraStatusText] = useState<string>(
    "Ready to open live webcam feed"
  );
  const [liveFingerExt, setLiveFingerExt] = useState<[number, number, number, number, number]>([
    0.85, 0.88, 0.86, 0.82, 0.78,
  ]);
  const [detectedLiveGesture, setDetectedLiveGesture] = useState<string>("FIST");
  const [resultData, setResultData] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<any>(null);
  const animRef = useRef<number | null>(null);

  const trajectoryBufferRef = useRef<number[]>([]);
  const handSamplesBufferRef = useRef<
    Array<{
      palmScale: number;
      fingerSpread: number;
      fingerExtensions: [number, number, number, number, number];
      wristAngleDeg: number;
      stability: number;
      gesture: string;
      timestampMs: number;
    }>
  >([]);
  const liveLandmarkFramesRef = useRef<
    Array<{
      tSec: number;
      gesture: string;
      confidence: number;
      landmarks: Array<{ x: number; y: number }>;
    }>
  >([]);
  const gestureTimelineRef = useRef<Array<{ gesture: string; tSec: number }>>([]);

  const latestLiveRef = useRef({
    liveTrajectoryY,
    liveHandParams,
    liveGesture,
    liveTremorHz,
    liveTremorAmp,
    liveStability,
    simulatedFreq,
    simulatedAmp,
  });

  useEffect(() => {
    latestLiveRef.current = {
      liveTrajectoryY,
      liveHandParams,
      liveGesture,
      liveTremorHz,
      liveTremorAmp,
      liveStability,
      simulatedFreq,
      simulatedAmp,
    };
  }, [
    liveTrajectoryY,
    liveHandParams,
    liveGesture,
    liveTremorHz,
    liveTremorAmp,
    liveStability,
    simulatedFreq,
    simulatedAmp,
  ]);

  const stopModalCamera = useCallback(() => {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (landmarkerRef.current) {
      try {
        landmarkerRef.current.close();
      } catch {
        // ignore
      }
      landmarkerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopModalCamera();
    }
    return () => stopModalCamera();
  }, [isOpen, stopModalCamera]);

  const finalizeEnrolment = async () => {
    stopModalCamera();
    setStep("PROCESSING");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/enrol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          condition,
          medicationState,
          cameraModeUsed,
          enrolmentDurationSec: Math.max(1, Math.round(elapsedSec || ENROLMENT_DURATION_SEC)),
          sampleRateHz: SAMPLE_RATE_HZ,
          simulatedFreqHz: simulatedFreq,
          simulatedAmplitude: simulatedAmp,
          trajectoryY: trajectoryBufferRef.current,
          handSamples: handSamplesBufferRef.current,
          liveLandmarkFrames: liveLandmarkFramesRef.current,
          gestureTimeline: gestureTimelineRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Enrolment request failed");
      }
      setResultData(data);
      setStep("COMPLETE");
      const createdProfile = data.profile || data.user;
      if (createdProfile) {
        onProfileCreated(createdProfile);
      }
    } catch (err: any) {
      console.error("Enrolment error:", err);
      setErrorMsg(err?.message || "Failed to save enrolment profile");
      setStep("SETUP");
    }
  };

  useEffect(() => {
    if (!isOpen || step !== "RECORDING") return;

    trajectoryBufferRef.current = [];
    handSamplesBufferRef.current = [];
    liveLandmarkFramesRef.current = [];
    gestureTimelineRef.current = [];
    setElapsedSec(0);
    setProgress(0);
    setSamplesCollected(0);
    setLandmarkFramesCount(0);

    let cancelled = false;
    let isWebcamLive = false;

    const initLiveCameraForEnrolment = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Webcam API unavailable");
        }
        setCameraStatusText("Opening live webcam & loading MediaPipe HandLandmarker...");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const loaded = await loadHandLandmarker(() => {}, "GPU");
        if (cancelled) {
          loaded.landmarker.close();
          return;
        }
        landmarkerRef.current = loaded.landmarker;
        isWebcamLive = true;
        setCameraModeUsed("LIVE_WEBCAM");
        setCameraStatusText(`REC LIVE WEBCAM (${loaded.delegate}) · Recording 21 Hand Landmarks`);
      } catch {
        isWebcamLive = false;
        setCameraModeUsed("SYNTHETIC_FALLBACK");
        setCameraStatusText(
          "REC SIMULATED FOOTAGE (No hardware webcam detected — recording synthetic hand kinematics)"
        );
      }
    };

    initLiveCameraForEnrolment();

    const startMs = Date.now();
    let lastObservationPostSec = 0;
    let frameCounter = 0;

    // 30 FPS canvas rendering & live landmark extraction loop
    const renderLoop = () => {
      if (cancelled) return;
      frameCounter += 1;
      const nowMs = Date.now();
      const sec = (nowMs - startMs) / 1000;
      const phaseIdx = Math.min(3, Math.floor(sec / 15));
      const targetPhaseGesture = ENROLMENT_PHASES[phaseIdx].targetGesture;

      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          let landmarks: HandLandmark2D[] | null = null;
          let mirrored = false;

          if (
            isWebcamLive &&
            video &&
            video.readyState >= 2 &&
            landmarkerRef.current
          ) {
            ctx.save();
            ctx.translate(w, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(video, 0, 0, w, h);
            ctx.restore();
            mirrored = true;

            try {
              const res = landmarkerRef.current.detectForVideo(video, performance.now());
              const lm = res?.landmarks?.[0];
              if (lm && lm.length === 21) {
                landmarks = lm.map((p: any) => ({ x: p.x, y: p.y, z: p.z }));
              }
            } catch {
              // ignore frame detect error
            }
          } else {
            ctx.fillStyle = "#090d16";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "rgba(30, 41, 59, 0.5)";
            for (let x = 0; x < w; x += 40) {
              ctx.beginPath();
              ctx.moveTo(x, 0);
              ctx.lineTo(x, h);
              ctx.stroke();
            }
            for (let y = 0; y < h; y += 40) {
              ctx.beginPath();
              ctx.moveTo(0, y);
              ctx.lineTo(w, y);
              ctx.stroke();
            }
            landmarks = generateSyntheticGestureLandmarks(
              targetPhaseGesture,
              sec,
              latestLiveRef.current.simulatedFreq,
              latestLiveRef.current.simulatedAmp
            );
          }

          if (landmarks) {
            const cls = classifyHandGesture(landmarks, null);
            const px = landmarks.map((p) => ({
              x: (mirrored ? 1 - p.x : p.x) * w,
              y: p.y * h,
            }));

            // Draw bounding box
            const xs = px.map((p) => p.x);
            const ys = px.map((p) => p.y);
            const minX = Math.max(10, Math.min(...xs) - 24);
            const maxX = Math.min(w - 10, Math.max(...xs) + 24);
            const minY = Math.max(10, Math.min(...ys) - 24);
            const maxY = Math.min(h - 10, Math.max(...ys) + 24);

            ctx.strokeStyle = "rgba(34, 211, 238, 0.85)";
            ctx.lineWidth = 2;
            ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

            // Draw skeleton
            ctx.strokeStyle = "rgba(6, 182, 212, 0.95)";
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
              ctx.arc(pt.x, pt.y, idx === 0 ? 6.5 : tip ? 5.5 : 3.5, 0, Math.PI * 2);
              ctx.fillStyle = idx === 0 ? "#ec4899" : tip ? "#a855f7" : "#06b6d4";
              ctx.fill();
            });

            // Record wrist trajectory & landmark snapshot for AI model training
            trajectoryBufferRef.current.push(Number(landmarks[0].y.toFixed(6)));

            if (frameCounter % 3 === 0) {
              setLiveFingerExt(cls.handParams.fingerFlexion);
              setDetectedLiveGesture(cls.gesture);

              handSamplesBufferRef.current.push({
                palmScale: cls.handParams.spanRatio,
                fingerSpread: cls.handParams.aspectRatio * 0.4,
                fingerExtensions: cls.handParams.fingerFlexion,
                wristAngleDeg: cls.handParams.tiltAngleDeg,
                stability: latestLiveRef.current.liveStability || 0.88,
                gesture: cls.gesture !== "UNKNOWN" ? cls.gesture : targetPhaseGesture,
                timestampMs: nowMs,
              });
            }

            if (frameCounter % 10 === 0) {
              liveLandmarkFramesRef.current.push({
                tSec: Number(sec.toFixed(2)),
                gesture: cls.gesture !== "UNKNOWN" ? cls.gesture : targetPhaseGesture,
                confidence: cls.confidence,
                landmarks: landmarks.map((p) => ({
                  x: Number(p.x.toFixed(4)),
                  y: Number(p.y.toFixed(4)),
                })),
              });
              setLandmarkFramesCount(liveLandmarkFramesRef.current.length);
            }
          }

          // REC overlay badge
          ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
          ctx.fillRect(12, 12, 275, 30);
          ctx.fillStyle = "#f43f5e";
          ctx.beginPath();
          ctx.arc(26, 27, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#f8fafc";
          ctx.font = "bold 12px monospace";
          ctx.fillText(
            `REC AI DATASET · ${trajectoryBufferRef.current.length} frames`,
            40,
            31
          );
        }
      }

      animRef.current = requestAnimationFrame(renderLoop);
    };

    animRef.current = requestAnimationFrame(renderLoop);

    const interval = setInterval(() => {
      const nowMs = Date.now();
      const sec = (nowMs - startMs) / 1000;
      const clampedSec = Math.min(ENROLMENT_DURATION_SEC, sec);
      const pct = Math.min(100, Math.round((clampedSec / ENROLMENT_DURATION_SEC) * 100));
      const phaseIdx = Math.min(3, Math.floor(clampedSec / 15));

      if (Math.floor(clampedSec) > gestureTimelineRef.current.length) {
        gestureTimelineRef.current.push({
          gesture: ENROLMENT_PHASES[phaseIdx].targetGesture,
          tSec: Math.floor(clampedSec),
        });
      }

      if (clampedSec - lastObservationPostSec >= 4) {
        lastObservationPostSec = clampedSec;
        fetch("/api/user-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userName: name,
            source: "ENROLMENT_LIVE_CAMERA_AI_TRAINING",
            gesture: ENROLMENT_PHASES[phaseIdx].targetGesture,
            tremorHz: latestLiveRef.current.simulatedFreq,
            tremorAmplitude: latestLiveRef.current.simulatedAmp,
            stability: latestLiveRef.current.liveStability || 0.88,
            fingerExtensions: liveFingerExt,
            medicationState,
            notes: `Live AI Training Stage ${phaseIdx + 1}/4 (${clampedSec.toFixed(1)}s / 60s)`,
          }),
        }).catch(() => {});
      }

      setElapsedSec(Number(clampedSec.toFixed(1)));
      setProgress(pct);
      setSamplesCollected(trajectoryBufferRef.current.length);

      if (clampedSec >= ENROLMENT_DURATION_SEC) {
        clearInterval(interval);
        finalizeEnrolment();
      }
    }, 150);

    return () => {
      cancelled = true;
      clearInterval(interval);
      stopModalCamera();
    };
  }, [isOpen, step]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const currentPhaseIndex = Math.min(3, Math.floor(elapsedSec / 15));
  const currentPhase = ENROLMENT_PHASES[currentPhaseIndex];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full p-6 shadow-2xl relative max-h-[94vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 p-1.5 rounded-lg bg-slate-800/70"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <UserPlus className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100">
              Live Camera Footage & Personalized AI Gesture Model Training (60s)
            </h3>
            <p className="text-xs text-slate-400">
              Records live hand footage & 21-point landmarks into{" "}
              <code className="text-cyan-300">storage/ai_training_dataset_*.json</code> and trains your personal gesture + tremor AI model.
            </p>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
            {errorMsg}
          </div>
        )}

        {step === "SETUP" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Patient / User Identifier
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1">
                  Motor Condition / Personalization Goal
                </label>
                <input
                  type="text"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-semibold text-cyan-400">
                  <Sliders className="w-4 h-4" />
                  <span>Baseline Tremor & Medication State</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {(["ON", "OFF", "UNKNOWN"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setMedicationState(st)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        medicationState === st
                          ? "bg-cyan-500/20 border-cyan-500 text-cyan-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      Med: {st}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Baseline Tremor Frequency (Hz)</span>
                  <span className="font-mono text-cyan-400">{simulatedFreq.toFixed(1)} Hz</span>
                </div>
                <input
                  type="range"
                  min="3.0"
                  max="11.0"
                  step="0.2"
                  value={simulatedFreq}
                  onChange={(e) => setSimulatedFreq(parseFloat(e.target.value))}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-400">Tremor RMS Amplitude (Normalized)</span>
                  <span className="font-mono text-purple-400">{simulatedAmp.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  min="0.005"
                  max="0.045"
                  step="0.002"
                  value={simulatedAmp}
                  onChange={(e) => setSimulatedAmp(parseFloat(e.target.value))}
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            {/* 4 Guided 15s Live Camera Training Stages */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
              <div className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
                <Video className="w-4 h-4 text-cyan-400" />
                <span>
                  Live Footage AI Training Protocol (Records 21-Keypoint Hand Movements & Gesture Centroids)
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ENROLMENT_PHASES.map((p) => (
                  <div
                    key={p.stage}
                    className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-[11px]"
                  >
                    <div className="flex items-center justify-between text-cyan-400 font-mono font-bold">
                      <span>
                        Stage {p.stage} ({p.rangeLabel})
                      </span>
                      <span>
                        {p.icon} {p.targetGesture}
                      </span>
                    </div>
                    <p className="text-slate-300 font-medium mt-0.5">{p.title}</p>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={() => setStep("RECORDING")}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center space-x-2"
            >
              <Camera className="w-4 h-4" />
              <span>Start Live Camera Recording & 60s AI Personalization</span>
            </button>
          </div>
        )}

        {step === "RECORDING" && (
          <div className="space-y-4">
            {/* Live Camera Video & 21-Keypoint Recording Feed */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute w-px h-px opacity-0 pointer-events-none"
            />

            <div className="relative rounded-xl overflow-hidden border-2 border-cyan-500/50 bg-slate-950 min-h-[340px] sm:min-h-[380px] flex items-center justify-center">
              <canvas
                ref={canvasRef}
                width={720}
                height={420}
                className="w-full h-full object-contain block"
              />
              <div className="absolute top-3 right-3 bg-slate-950/90 px-3 py-1.5 rounded-lg border border-cyan-500/40 text-xs font-mono text-cyan-300">
                {elapsedSec.toFixed(1)}s / 60s ({progress}%)
              </div>
              <div className="absolute bottom-3 left-3 right-3 bg-slate-950/90 px-3 py-2 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-emerald-400">{cameraStatusText}</span>
                <span className="text-cyan-300">
                  Detected: <strong>{detectedLiveGesture}</strong> · Snapshots:{" "}
                  {landmarkFramesCount}
                </span>
              </div>
            </div>

            {/* Active Guided Gesture Stage */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  Stage {currentPhase.stage} of 4 · {currentPhase.rangeLabel} · Show Gesture:{" "}
                  {currentPhase.icon} {currentPhase.targetGesture}
                </span>
                <h4 className="text-sm font-bold text-slate-100 mt-1.5">
                  {currentPhase.title}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">{currentPhase.instruction}</p>
              </div>
              <div className="text-right font-mono text-xs flex-shrink-0">
                <div className="text-cyan-400 font-bold">{samplesCollected} frames</div>
                <div className="text-[10px] text-slate-500">recorded to AI dataset</div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1">
              <div className="w-full bg-slate-950 h-3 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 h-full transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {/* Action Buttons: Train & Save Now or Wait Full 60s */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={finalizeEnrolment}
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-lg"
              >
                <Cpu className="w-4 h-4" />
                <span>
                  Train AI Model & Save Profile Now ({samplesCollected} live frames recorded)
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopModalCamera();
                  setStep("SETUP");
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "PROCESSING" && (
          <div className="py-12 text-center space-y-3">
            <Activity className="w-10 h-10 text-cyan-400 animate-spin mx-auto" />
            <h4 className="text-sm font-bold text-slate-100">
              Training Personalized Hand Gesture AI Prototypes & Saving Footage Dataset...
            </h4>
            <p className="text-xs text-slate-400">
              Writing recorded landmarks to <code>storage/ai_training_dataset_*.json</code> and{" "}
              <code>storage/ai_trained_model_*.json</code>
            </p>
          </div>
        )}

        {step === "COMPLETE" && resultData && (
          <div className="space-y-4">
            <div className="bg-emerald-950/30 border border-emerald-500/40 rounded-xl p-4 flex items-center space-x-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
              <div>
                <h4 className="text-xs font-bold text-emerald-300">
                  Personalized AI Gesture & Tremor Model Trained & Saved!
                </h4>
                <p className="text-[11px] text-slate-300">
                  Trained on {resultData.analysis?.samplesAnalyzed} frames (
                  {resultData.analysis?.enrolmentDurationSec}s @{" "}
                  {resultData.analysis?.sampleRateHz} Hz · Mode:{" "}
                  {resultData.analysis?.cameraModeUsed}).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">Dominant Peak (f0)</span>
                <span className="font-mono font-bold text-cyan-400 text-sm">
                  {resultData.analysis?.estimatedF0Hz} Hz
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Band-Stop Filter</span>
                <span className="font-mono font-bold text-purple-400 text-sm">
                  {resultData.analysis?.bandStopRangeHz?.[0]} –{" "}
                  {resultData.analysis?.bandStopRangeHz?.[1]} Hz
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Tremor RMS Amp</span>
                <span className="font-mono font-bold text-amber-400 text-sm">
                  {resultData.analysis?.amplitudeRms}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Dwell Multiplier</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {resultData.analysis?.recommendedDwellScale}x
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Palm Scale / Flex</span>
                <span className="font-mono font-bold text-sky-400 text-sm">
                  {resultData.analysis?.handMorphology?.palmScale} /{" "}
                  {resultData.analysis?.handMorphology?.fingerFlexibility}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">60s Fatigue Drift</span>
                <span className="font-mono font-bold text-rose-400 text-sm">
                  {resultData.analysis?.fatigueIndex >= 0 ? "+" : ""}
                  {resultData.analysis?.fatigueIndex}
                </span>
              </div>
            </div>

            {resultData.analysis?.handMorphology?.perFingerExtensionAvg && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs">
                <div className="flex items-center gap-1.5 text-slate-300 font-semibold mb-2">
                  <Hand className="w-3.5 h-3.5 text-cyan-400" />
                  <span>AI-Trained Per-Finger Extension Centroid</span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-center font-mono text-[11px]">
                  {["Thumb", "Index", "Middle", "Ring", "Pinky"].map((label, i) => (
                    <div
                      key={label}
                      className="bg-slate-900 border border-slate-800 rounded p-1.5"
                    >
                      <span className="text-[10px] text-slate-400 block">{label}</span>
                      <span className="text-cyan-300 font-bold">
                        {(
                          resultData.analysis.handMorphology.perFingerExtensionAvg[i] * 100
                        ).toFixed(0)}
                        %
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {resultData.storagePaths && (
              <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 text-[11px] font-mono text-slate-300 space-y-1">
                <div className="flex items-center gap-1.5 text-cyan-400 font-sans font-semibold text-xs mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  <span>AI Model & Live Footage Dataset Files Saved on Disk</span>
                </div>
                <div>• AI Training Dataset: {resultData.storagePaths.aiTrainingDatasetFile}</div>
                <div>• Trained AI Model Weights: {resultData.storagePaths.aiTrainedModelFile}</div>
                <div>• Live Landmark Log: {resultData.storagePaths.liveFootageLogFile}</div>
                <div>• User Profile JSON: {resultData.storagePaths.userProfileFile}</div>
              </div>
            )}

            <button
              onClick={() => {
                setStep("SETUP");
                onClose();
              }}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-all"
            >
              Activate Personalized AI Model & Return to Controller
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
