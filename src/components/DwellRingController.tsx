"use client";

import React, { useState, useEffect, useRef } from "react";
import { Appliance, UserProfile, RiskTier, BaselineMode, ActuationResult } from "@/lib/types";
import { calculateRequiredDwellMs } from "@/lib/steady-gate";
import { Flame, ShieldAlert, CheckCircle2, RotateCcw, Lock, ThumbsUp, Sparkles } from "lucide-react";

interface DwellRingControllerProps {
  appliance: Appliance | null;
  user: UserProfile | null;
  fusedIntent: number;
  baselineMode: BaselineMode;
  onExecuteActuation: (params: {
    applianceId: string;
    gesture: string;
    dwellTimeHeldMs: number;
    isSecondaryHandshakeGesture?: boolean;
    wasReAttempt?: boolean;
  }) => Promise<ActuationResult | null>;
  recentRejectTime: number | null;
}

export const DwellRingController: React.FC<DwellRingControllerProps> = ({
  appliance,
  user,
  fusedIntent,
  baselineMode,
  onExecuteActuation,
  recentRejectTime,
}) => {
  const [isHolding, setIsHolding] = useState(false);
  const [heldMs, setHeldMs] = useState(0);
  const [handshakeStep, setHandshakeStep] = useState<"IDLE" | "PRIMARY_ARMED" | "SECONDARY_HOLDING">(
    "IDLE"
  );
  const [handshakeTimer, setHandshakeTimer] = useState(5.0);
  const [lastActionResult, setLastActionResult] = useState<ActuationResult | null>(null);

  const holdIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const handshakeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentRisk: RiskTier = appliance?.riskTier || "R0";
  const userAmp = user?.amplitudeRms || 0.045;

  // Compute required dwell
  let requiredMs = 1200;
  if (baselineMode === "B0_RAW") {
    requiredMs = 500;
  } else if (baselineMode === "B1_WAKE_STATE") {
    requiredMs = 1200;
  } else if (baselineMode === "B2_FIXED_DWELL") {
    requiredMs = currentRisk === "R0" ? 2000 : 4000;
  } else {
    // SteadyGate adaptive dwell
    requiredMs = calculateRequiredDwellMs(currentRisk, fusedIntent, userAmp);
  }

  const progressPct = Math.min(100, Math.round((heldMs / requiredMs) * 100));

  // Circular ring geometry
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (progressPct / 100) * circumference;

  // Manage Holding Timer
  useEffect(() => {
    if (isHolding) {
      const step = 40;
      holdIntervalRef.current = setInterval(() => {
        setHeldMs((prev) => {
          const next = prev + step;
          if (next >= requiredMs) {
            clearInterval(holdIntervalRef.current!);
            handleDwellComplete();
            return requiredMs;
          }
          return next;
        });
      }, step);
    } else {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
      if (handshakeStep === "IDLE") {
        setHeldMs(0);
      }
    }

    return () => {
      if (holdIntervalRef.current) clearInterval(holdIntervalRef.current);
    };
  }, [isHolding, requiredMs, handshakeStep]);

  // Manage R2 5-second handshake countdown
  useEffect(() => {
    if (handshakeStep === "PRIMARY_ARMED") {
      setHandshakeTimer(5.0);
      handshakeIntervalRef.current = setInterval(() => {
        setHandshakeTimer((t) => {
          if (t <= 0.1) {
            clearInterval(handshakeIntervalRef.current!);
            setHandshakeStep("IDLE");
            setHeldMs(0);
            return 0;
          }
          return Math.round((t - 0.1) * 10) / 10;
        });
      }, 100);
    } else {
      if (handshakeIntervalRef.current) clearInterval(handshakeIntervalRef.current);
    }

    return () => {
      if (handshakeIntervalRef.current) clearInterval(handshakeIntervalRef.current);
    };
  }, [handshakeStep]);

  // Triggered when primary dwell duration completes
  const handleDwellComplete = async () => {
    setIsHolding(false);
    if (!appliance) return;

    // Check if recent retry within 3 seconds
    const wasReAttempt = !!(recentRejectTime && Date.now() - recentRejectTime < 3500);

    // If R2 appliance under SteadyGate, escalate to secondary handshake
    if (currentRisk === "R2" && baselineMode === "STEADYGATE" && handshakeStep === "IDLE") {
      setHandshakeStep("PRIMARY_ARMED");
      // Call gate for primary verification
      const res = await onExecuteActuation({
        applianceId: appliance.id,
        gesture: "OPEN_PALM",
        dwellTimeHeldMs: requiredMs,
        isSecondaryHandshakeGesture: false,
        wasReAttempt,
      });
      setLastActionResult(res);
      return;
    }

    // Execute direct actuation (for R0, R1, or completed secondary handshake)
    const isSecondary = handshakeStep === "PRIMARY_ARMED" || handshakeStep === "SECONDARY_HOLDING";
    const gesture = isSecondary ? "THUMBS_UP" : "OPEN_PALM";

    const res = await onExecuteActuation({
      applianceId: appliance.id,
      gesture,
      dwellTimeHeldMs: requiredMs,
      isSecondaryHandshakeGesture: isSecondary,
      wasReAttempt,
    });

    setLastActionResult(res);
    setHandshakeStep("IDLE");
    setHeldMs(0);
  };

  // Trigger secondary gesture confirmation for R2
  const handleTriggerSecondaryGesture = async () => {
    if (!appliance) return;
    const wasReAttempt = !!(recentRejectTime && Date.now() - recentRejectTime < 3500);
    const res = await onExecuteActuation({
      applianceId: appliance.id,
      gesture: "THUMBS_UP",
      dwellTimeHeldMs: 1000,
      isSecondaryHandshakeGesture: true,
      wasReAttempt,
    });
    setLastActionResult(res);
    setHandshakeStep("IDLE");
    setHeldMs(0);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm flex flex-col justify-between">
      {/* Target Appliance Banner */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${
                currentRisk === "R2"
                  ? "bg-rose-950 text-rose-400 border border-rose-800"
                  : currentRisk === "R1"
                  ? "bg-blue-950 text-blue-400 border border-blue-800"
                  : "bg-emerald-950 text-emerald-400 border border-emerald-800"
              }`}
            >
              {currentRisk} TIER
            </span>
            <h4 className="text-sm font-semibold text-slate-100">
              {appliance?.name || "Select an Appliance"}
            </h4>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
            {appliance?.hazardDescription || "Low risk LED lighting, safe for fast dwell."}
          </p>
        </div>

        {/* Current Power State */}
        <div className="text-right">
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              appliance?.powerState === "ON"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                : "bg-slate-800 text-slate-400 border border-slate-700"
            }`}
          >
            {appliance?.powerState || "OFF"}
          </span>
        </div>
      </div>

      {/* R2 Handshake Alert Banner (When Armed) */}
      {handshakeStep === "PRIMARY_ARMED" && (
        <div className="my-3 p-3 rounded-lg bg-amber-950/60 border border-amber-600 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-400 flex-shrink-0" />
              <div>
                <h5 className="text-xs font-bold text-amber-200">
                  R2 TWO-GESTURE CONFIRMATION ESCALATION
                </h5>
                <p className="text-[11px] text-amber-300/90">
                  Primary intent sustained. To ignite 450°C coil / unlatch deadbolt, present{" "}
                  <strong>THUMBS_UP</strong> handshake within {handshakeTimer.toFixed(1)}s!
                </p>
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              onClick={handleTriggerSecondaryGesture}
              className="flex-1 py-1.5 px-3 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md"
            >
              <ThumbsUp className="w-4 h-4" />
              Confirm with THUMBS_UP Handshake ({handshakeTimer.toFixed(1)}s)
            </button>
            <button
              onClick={() => setHandshakeStep("IDLE")}
              className="px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Dynamic Circular Dwell Ring */}
      <div className="flex flex-col items-center justify-center py-4">
        <div className="relative w-36 h-36 flex items-center justify-center">
          <svg className="w-full h-full transform -rotate-90">
            {/* Background track */}
            <circle
              cx="72"
              cy="72"
              r={radius}
              stroke="currentColor"
              strokeWidth="9"
              fill="transparent"
              className="text-slate-800/80"
            />
            {/* Animated progress ring */}
            <circle
              cx="72"
              cy="72"
              r={radius}
              stroke="currentColor"
              strokeWidth="9"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className={`transition-all duration-75 ${
                progressPct >= 100
                  ? "text-emerald-400"
                  : currentRisk === "R2"
                  ? "text-rose-500"
                  : currentRisk === "R1"
                  ? "text-blue-500"
                  : "text-cyan-400"
              }`}
            />
          </svg>

          {/* Center Info in Circle */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-2">
            <span className="text-xl font-extrabold font-mono text-white">
              {progressPct}%
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {heldMs} / {requiredMs} ms
            </span>
            {isHolding && (
              <span className="text-[9px] text-cyan-300 animate-pulse font-medium mt-0.5">
                Dwelling...
              </span>
            )}
          </div>
        </div>

        {/* Dwell Formula Calculation Breakdown */}
        <div className="mt-3 text-center text-xs text-slate-400 max-w-sm">
          <span className="font-mono text-[11px] text-slate-300">
            T_req = T_base({currentRisk}) × (1 + 3·A₀) + k({currentRisk})·(1 - I)
          </span>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Tremor scaling factor: +{((Math.min(2.5, userAmp * 12.0)) * 100).toFixed(0)}% time for
            achievable motor stability
          </p>
        </div>
      </div>

      {/* Hold / Gesture Simulation Buttons */}
      <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
        <button
          onMouseDown={() => setIsHolding(true)}
          onMouseUp={() => setIsHolding(false)}
          onTouchStart={() => setIsHolding(true)}
          onTouchEnd={() => setIsHolding(false)}
          disabled={!appliance}
          className={`w-full py-2.5 rounded-lg font-semibold text-xs transition-all shadow-md flex items-center justify-center gap-2 select-none ${
            isHolding
              ? "bg-cyan-600 text-white scale-[0.98]"
              : "bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white"
          }`}
        >
          <Sparkles className="w-4 h-4 text-cyan-200" />
          {isHolding ? "Holding Intent Gesture..." : "Press & Hold Intent Gesture (OPEN_PALM)"}
        </button>

        {/* 1-Click Fast Actuate (for quick testing) */}
        <button
          onClick={handleDwellComplete}
          disabled={!appliance}
          className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
        >
          ⚡ Simulate Sustained Dwell Actuation ({requiredMs} ms)
        </button>
      </div>
    </div>
  );
};
