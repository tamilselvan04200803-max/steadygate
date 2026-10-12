"use client";

import React from "react";
import { IntentComponents, UserProfile } from "@/lib/types";
import { Eye, ShieldCheck, Sun, HelpCircle, Sparkles } from "lucide-react";

interface IntentFusionRadarProps {
  intent: IntentComponents;
  user: UserProfile | null;
  onUpdateComponent?: (key: keyof IntentComponents, val: number) => void;
}

export const IntentFusionRadar: React.FC<IntentFusionRadarProps> = ({
  intent,
  user,
}) => {
  const attentionFloor = user?.attentionFloor || 0.60;
  const isAttentionLow = intent.attention < attentionFloor;
  const isSceneDark = intent.sceneQuality < 0.35;
  const isMarginNarrow = intent.margin < 0.15;
  const isStabilityLow = intent.stabilityNorm < 0.50;

  const items = [
    {
      label: "Gesture Posterior",
      sub: "Top-1 classification confidence",
      value: intent.posterior,
      icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
      color: "bg-cyan-500",
      status: intent.posterior >= 0.70 ? "Pass" : "Low",
      statusColor: intent.posterior >= 0.70 ? "text-emerald-400" : "text-amber-400",
    },
    {
      label: "Classification Margin",
      sub: "Top-1 vs Top-2 class distance",
      value: Math.min(1, intent.margin * 2.0),
      displayVal: intent.margin,
      icon: <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />,
      color: "bg-indigo-500",
      status: !isMarginNarrow ? "Clear" : "Ambiguous",
      statusColor: !isMarginNarrow ? "text-emerald-400" : "text-amber-400",
    },
    {
      label: "Head-Pose Attention",
      sub: `FaceMesh yaw/pitch gaze (min ${(attentionFloor * 100).toFixed(0)}%)`,
      value: intent.attention,
      icon: <Eye className="w-3.5 h-3.5 text-blue-400" />,
      color: "bg-blue-500",
      status: !isAttentionLow ? "Attentive" : "Looking Away",
      statusColor: !isAttentionLow ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Tremor-Normalized Stillness",
      sub: "Post-notch residual motion stability",
      value: intent.stabilityNorm,
      icon: <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />,
      color: "bg-purple-500",
      status: !isStabilityLow ? "Stable" : "Excess Jitter",
      statusColor: !isStabilityLow ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Scene Quality / Lux",
      sub: "Camera exposure & illumination",
      value: intent.sceneQuality,
      icon: <Sun className="w-3.5 h-3.5 text-amber-400" />,
      color: "bg-amber-500",
      status: !isSceneDark ? "Good Light" : "Poor Light",
      statusColor: !isSceneDark ? "text-emerald-400" : "text-rose-400",
    },
    {
      label: "Device Context Prior",
      sub: "Current appliance state prior",
      value: intent.contextPrior,
      icon: <Sparkles className="w-3.5 h-3.5 text-emerald-400" />,
      color: "bg-emerald-500",
      status: "Verified",
      statusColor: "text-emerald-400",
    },
  ];

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      {/* Header with Fused Intent Gauge */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            Calibrated Intent Fusion Engine (F3)
          </h3>
          <p className="text-xs text-slate-400">
            Multi-modal multiplicative gate: Posterior × Margin × Attention × S_norm × Lux × Context
          </p>
        </div>

        {/* Fused Score Badge */}
        <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-lg">
          <span className="text-xs text-slate-400 font-mono">Fused I:</span>
          <span
            className={`text-base font-bold font-mono ${
              intent.fusedIntent >= 0.70
                ? "text-cyan-400"
                : intent.fusedIntent >= 0.50
                ? "text-amber-400"
                : "text-rose-400"
            }`}
          >
            {(intent.fusedIntent * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 6 Component Breakdown Bars */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        {items.map((item, idx) => (
          <div key={idx} className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                {item.icon}
                {item.label}
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium ${item.statusColor}`}>
                  {item.status}
                </span>
                <span className="font-mono text-slate-200">
                  {((item.displayVal !== undefined ? item.displayVal : item.value) * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <div className="w-full bg-slate-800/90 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full ${item.color} transition-all duration-150`}
                style={{ width: `${Math.min(100, Math.max(0, item.value * 100))}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-1">{item.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
