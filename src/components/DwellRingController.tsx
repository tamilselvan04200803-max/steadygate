"use client";

import React, { useState, useEffect, useRef } from "react";
import { Appliance, UserProfile, RejectCode } from "@/lib/types";

export type HandshakeStage = "IDLE" | "PRIMARY_HOLD" | "AWAITING_CONFIRM" | "CONFIRMED";
import { APPLIANCE_DEFAULT_GESTURE_LABEL } from "@/lib/default-gesture-map";
import {
  ShieldAlert,
  CheckCircle2,
  Hand,
  Lock,
  Sparkles,
  AlertOctagon,
  Play,
  RotateCcw,
  Power,
} from "lucide-react";

interface DwellRingControllerProps {
  selectedAppliance: Appliance | null;
  selectedProfile: UserProfile | null;
  liveIntentScore: number;
  liveStabilityNorm: number;
  livePosterior: number;
  liveMargin: number;
  liveAttention: number;
  liveLighting: number;
  liveTremorAmp: number;
  liveDetectedGesture: string;
  baselineMode: "RAW_MEDIA_PIPE" | "FIXED_DWELL_800MS" | "STEADYGATE";
  onSetBaselineMode: (mode: "RAW_MEDIA_PIPE" | "FIXED_DWELL_800MS" | "STEADYGATE") => void;
  onActuateComplete: (payload: {
    status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING";
    rejectCode: RejectCode;
    dwellTimeMs: number;
    dwellRequiredMs: number;
    handshakeStage: HandshakeStage;
    calibratedNudge: boolean;
    command: string;
  }) => void;
  onDirectToggleAppliance?: (appliance: Appliance) => void;
}

export const DwellRingController: React.FC<DwellRingControllerProps> = ({
  selectedAppliance,
  selectedProfile,
  liveIntentScore,
  liveStabilityNorm,
  livePosterior,
  liveMargin,
  liveAttention,
  liveLighting,
  liveTremorAmp,
  liveDetectedGesture,
  baselineMode,
  onSetBaselineMode,
  onActuateComplete,
  onDirectToggleAppliance,
}) => {
  const [isHolding, setIsHolding] = useState(false);
  const [dwellElapsedMs, setDwellElapsedMs] = useState(0);
  const [handshakeStage, setHandshakeStage] = useState<HandshakeStage>("IDLE");
  const [lastOutcome, setLastOutcome] = useState<{
    status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING" | null;
    rejectCode: RejectCode;
    message: string;
    calibrated: boolean;
  }>({ status: null, rejectCode: "NONE", message: "", calibrated: false });

  const holdStartRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);

  const getRequiredDwellMs = (): number => {
    if (!selectedAppliance) return 500;
    if (baselineMode === "RAW_MEDIA_PIPE") return 150;
    if (baselineMode === "FIXED_DWELL_800MS") return 800;

    const scale = selectedProfile?.adaptiveDwellFactor || 1.0;
    const baseMs =
      selectedAppliance.riskTier === "R0"
        ? 300
        : selectedAppliance.riskTier === "R1"
        ? 600
        : 950;
    return Math.round(baseMs * scale);
  };

  const requiredDwellMs = getRequiredDwellMs();

  useEffect(() => {
    setIsHolding(false);
    setDwellElapsedMs(0);
    setHandshakeStage("IDLE");
  }, [selectedAppliance?.id]);

  useEffect(() => {
    if (!isHolding || !selectedAppliance) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }

    holdStartRef.current = performance.now() - dwellElapsedMs;

    const tick = (now: number) => {
      const elapsed = Math.max(0, Math.round(now - (holdStartRef.current || now)));
      setDwellElapsedMs(elapsed);

      if (elapsed >= requiredDwellMs) {
        setIsHolding(false);
        evaluateGateOutcome(elapsed);
        return;
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isHolding, requiredDwellMs, selectedAppliance]);

  const evaluateGateOutcome = (finalDwellMs: number) => {
    if (!selectedAppliance || !selectedProfile) return;

    let rejectCode: RejectCode = "NONE";
    if (liveLighting < 0.35) {
      rejectCode = "POOR_LIGHT";
    } else if (liveAttention < 0.5) {
      rejectCode = "LOW_ATTENTION";
    } else if (liveMargin < 0.2) {
      rejectCode = "AMBIGUOUS_CLASS";
    } else if (
      baselineMode !== "STEADYGATE" &&
      liveTremorAmp > selectedProfile.amplitudeRms * 0.9
    ) {
      rejectCode = "TREMOR_EXCEEDS_PROFILE";
    } else if (liveIntentScore < 0.42) {
      rejectCode = "GESTURE_UNSTABLE";
    }

    if (rejectCode !== "NONE") {
      setLastOutcome({
        status: "REJECTED",
        rejectCode,
        message: `Command blocked by Safety Gate (${rejectCode}).`,
        calibrated: false,
      });

      onActuateComplete({
        status: "REJECTED",
        rejectCode,
        dwellTimeMs: finalDwellMs,
        dwellRequiredMs: requiredDwellMs,
        handshakeStage,
        calibratedNudge: false,
        command: `${selectedAppliance.name} -> REJECTED`,
      });
      setDwellElapsedMs(0);
      return;
    }

    const nextPower = selectedAppliance.powerState === "ON" ? "OFF" : "ON";
    const calibrated = lastOutcome.status === "REJECTED";

    setHandshakeStage("CONFIRMED");
    setLastOutcome({
      status: "ACTUATED",
      rejectCode: "NONE",
      message: `${selectedAppliance.name} switched ${nextPower}!`,
      calibrated,
    });

    onActuateComplete({
      status: "ACTUATED",
      rejectCode: "NONE",
      dwellTimeMs: finalDwellMs,
      dwellRequiredMs: requiredDwellMs,
      handshakeStage: "CONFIRMED",
      calibratedNudge: calibrated,
      command: `SET_POWER_${nextPower}`,
    });

    setTimeout(() => {
      setHandshakeStage("IDLE");
      setDwellElapsedMs(0);
    }, 1000);
  };

  const progressPct = Math.min(100, Math.round((dwellElapsedMs / requiredDwellMs) * 100));
  const strokeDashoffset = 283 - (283 * progressPct) / 100;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl backdrop-blur-sm flex flex-col justify-between">
      {/* Header & Baseline Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <Lock className="w-4 h-4 text-cyan-400" />
            Intent-Verified Dwell Gate & Direct Actuation
          </h3>
          <p className="text-xs text-slate-400">
            Hold a hand gesture (e.g. <strong>✋ OPEN_PALM</strong> for Fan) or use the controls below
          </p>
        </div>

        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-mono">
          <button
            onClick={() => onSetBaselineMode("RAW_MEDIA_PIPE")}
            className={`px-2 py-1 rounded transition-all ${
              baselineMode === "RAW_MEDIA_PIPE"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Raw MediaPipe
          </button>
          <button
            onClick={() => onSetBaselineMode("FIXED_DWELL_800MS")}
            className={`px-2 py-1 rounded transition-all ${
              baselineMode === "FIXED_DWELL_800MS"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Fixed 800ms
          </button>
          <button
            onClick={() => onSetBaselineMode("STEADYGATE")}
            className={`px-2 py-1 rounded transition-all ${
              baselineMode === "STEADYGATE"
                ? "bg-cyan-500 text-slate-950 font-bold"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            SteadyGate
          </button>
        </div>
      </div>

      {selectedAppliance ? (
        <div className="my-4 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          {/* Circular Dwell Progress Ring */}
          <div className="md:col-span-5 flex flex-col items-center justify-center">
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="transparent"
                  stroke="#1e293b"
                  strokeWidth="8"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="transparent"
                  stroke={
                    selectedAppliance.riskTier === "R2"
                      ? "#f43f5e"
                      : selectedAppliance.riskTier === "R1"
                      ? "#3b82f6"
                      : "#10b981"
                  }
                  strokeWidth="8"
                  strokeDasharray="283"
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  className="transition-all duration-75"
                />
              </svg>

              <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  {selectedAppliance.riskTier} Gate
                </span>
                <span className="text-xl font-bold font-mono text-slate-100">
                  {progressPct}%
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  {dwellElapsedMs} / {requiredDwellMs}ms
                </span>
              </div>
            </div>
          </div>

          {/* Right Side Target Details & Trigger Buttons */}
          <div className="md:col-span-7 space-y-3">
            <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200">
                  Target: {selectedAppliance.name}
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                    selectedAppliance.powerState === "ON"
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                      : "bg-slate-800 text-slate-300"
                  }`}
                >
                  State: {selectedAppliance.powerState}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">Assigned Default Gesture:</span>
                <span className="text-cyan-300 font-bold">
                  {APPLIANCE_DEFAULT_GESTURE_LABEL[selectedAppliance.id] || "✋ OPEN_PALM"}
                </span>
              </div>

              {/* Factor Breakdown */}
              <div className="mt-2.5 grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
                <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                  <div className="text-slate-500">Post. P</div>
                  <div className="text-cyan-400 font-bold">
                    {(livePosterior * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                  <div className="text-slate-500">Margin</div>
                  <div className="text-indigo-400 font-bold">
                    {(liveMargin * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                  <div className="text-slate-500">Attn A</div>
                  <div className="text-blue-400 font-bold">
                    {(liveAttention * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-slate-900 p-1.5 rounded border border-slate-800">
                  <div className="text-slate-500">S_norm</div>
                  <div className="text-purple-400 font-bold">
                    {(liveStabilityNorm * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Hold & Instant Toggle Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onMouseDown={() => setIsHolding(true)}
                onMouseUp={() => {
                  setIsHolding(false);
                  setDwellElapsedMs(0);
                }}
                onMouseLeave={() => {
                  if (isHolding) {
                    setIsHolding(false);
                    setDwellElapsedMs(0);
                  }
                }}
                onTouchStart={() => setIsHolding(true)}
                onTouchEnd={() => {
                  setIsHolding(false);
                  setDwellElapsedMs(0);
                }}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all select-none shadow-md ${
                  isHolding
                    ? "bg-cyan-400 text-slate-950 scale-[0.99]"
                    : "bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950"
                }`}
              >
                <Hand className="w-4 h-4" />
                <span>{isHolding ? "Holding Dwell Gate..." : "Hold for Dwell Gate"}</span>
              </button>

              <button
                type="button"
                onClick={() => onDirectToggleAppliance?.(selectedAppliance)}
                className={`py-2.5 px-3 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md ${
                  selectedAppliance.powerState === "ON"
                    ? "bg-rose-600 hover:bg-rose-500 text-white"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`}
              >
                <Power className="w-4 h-4" />
                <span>
                  Turn {selectedAppliance.powerState === "ON" ? "OFF" : "ON"} Now
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-8 text-center text-slate-400 text-xs">
          Select an appliance to begin gesture-gated actuation.
        </div>
      )}

      {/* Outcome Banner */}
      {lastOutcome.status && (
        <div
          className={`mt-2 p-3 rounded-lg border text-xs flex items-start space-x-2.5 ${
            lastOutcome.status === "ACTUATED"
              ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-200"
              : "bg-rose-950/50 border-rose-500/40 text-rose-200"
          }`}
        >
          {lastOutcome.status === "ACTUATED" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertOctagon className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="font-bold">
                {lastOutcome.status === "ACTUATED"
                  ? "ACTUATION VERIFIED"
                  : `REFUSED [${lastOutcome.rejectCode}]`}
              </span>
              {lastOutcome.calibrated && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> Self-Calibrated
                </span>
              )}
            </div>
            <p className="text-[11px] opacity-90 mt-0.5">{lastOutcome.message}</p>
          </div>
        </div>
      )}
    </div>
  );
};
