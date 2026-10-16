"use client";

import React from "react";
import { Appliance, RiskTier } from "@/lib/types";
import { APPLIANCE_DEFAULT_GESTURE_LABEL } from "@/lib/default-gesture-map";
import {
  Flame,
  Droplets,
  Lock,
  Lamp,
  Fan,
  Wind,
  Blinds,
  Tv,
  CheckCircle,
  Zap,
  Power,
  RefreshCw,
} from "lucide-react";

interface ApplianceCardGridProps {
  appliances: Appliance[];
  selectedAppliance: Appliance | null;
  onSelectAppliance: (appliance: Appliance) => void;
  onTogglePower?: (appliance: Appliance) => void;
  onCycleFanSpeed?: (appliance: Appliance) => void;
}

export const ApplianceCardGrid: React.FC<ApplianceCardGridProps> = ({
  appliances,
  selectedAppliance,
  onSelectAppliance,
  onTogglePower,
  onCycleFanSpeed,
}) => {
  const getIcon = (name: string, riskTier: RiskTier) => {
    switch (name.toLowerCase()) {
      case "lamp":
        return <Lamp className="w-5 h-5 text-amber-400" />;
      case "fan":
        return <Fan className="w-5 h-5 text-cyan-400" />;
      case "wind":
        return <Wind className="w-5 h-5 text-blue-400" />;
      case "blinds":
        return <Blinds className="w-5 h-5 text-indigo-400" />;
      case "tv":
        return <Tv className="w-5 h-5 text-purple-400" />;
      case "flame":
        return <Flame className="w-5 h-5 text-rose-500" />;
      case "droplets":
        return <Droplets className="w-5 h-5 text-sky-400" />;
      case "lock":
        return <Lock className="w-5 h-5 text-red-500" />;
      default:
        return riskTier === "R2" ? (
          <Flame className="w-5 h-5 text-rose-500" />
        ) : (
          <Zap className="w-5 h-5 text-cyan-400" />
        );
    }
  };

  const r0Appliances = appliances.filter((a) => a.riskTier === "R0");
  const r1Appliances = appliances.filter((a) => a.riskTier === "R1");
  const r2Appliances = appliances.filter((a) => a.riskTier === "R2");

  const renderSection = (
    tier: RiskTier,
    title: string,
    badgeColor: string,
    description: string,
    items: Appliance[]
  ) => {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded font-mono ${badgeColor}`}>
              {tier}
            </span>
            <h4 className="text-sm font-semibold text-slate-200">{title}</h4>
          </div>
          <span className="text-[11px] text-slate-400">{description}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((app) => {
            const isSelected = selectedAppliance?.id === app.id;
            const isOn = app.powerState === "ON";
            const defaultGesture =
              APPLIANCE_DEFAULT_GESTURE_LABEL[app.id] || "✋ OPEN_PALM (Toggle ON/OFF)";

            return (
              <div
                key={app.id}
                onClick={() => onSelectAppliance(app)}
                className={`relative rounded-xl p-4 border transition-all cursor-pointer select-none flex flex-col justify-between ${
                  isSelected
                    ? "bg-slate-900 border-cyan-500 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-950/50"
                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90"
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-1.5 -right-1.5 bg-cyan-500 text-slate-950 rounded-full p-0.5 shadow-md">
                    <CheckCircle className="w-3.5 h-3.5 fill-cyan-500 text-slate-950" />
                  </div>
                )}

                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div
                        className={`p-2 rounded-lg ${
                          isOn
                            ? tier === "R2"
                              ? "bg-rose-500/20 text-rose-400"
                              : tier === "R1"
                              ? "bg-blue-500/20 text-blue-400"
                              : "bg-emerald-500/20 text-emerald-400"
                            : "bg-slate-800 text-slate-500"
                        }`}
                      >
                        {getIcon(app.iconName, app.riskTier)}
                      </div>
                      <div>
                        <h5 className="text-xs font-bold text-slate-100">{app.name}</h5>
                        <span className="text-[10px] text-slate-400">{app.location}</span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isOn
                          ? tier === "R2"
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                            : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {app.powerState}
                    </span>
                  </div>

                  {/* Default Gesture Binding */}
                  <div className="mt-3 px-2.5 py-1.5 rounded-lg bg-slate-950/80 border border-slate-800 flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Default Gesture:</span>
                    <span className="font-mono font-semibold text-cyan-300">{defaultGesture}</span>
                  </div>

                  {/* State Value */}
                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-300">
                    <span className="text-slate-400 text-[11px]">Telemetry Status:</span>
                    <span className="font-mono font-semibold">
                      {app.id === "fan_table"
                        ? `Speed ${app.fanSpeed} (${app.airRpm} RPM)`
                        : `${app.targetValue} ${app.unit} (${app.activeWattage} W)`}
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80">
                    <p className="text-[10px] text-slate-400 leading-tight">
                      {app.hazardDescription}
                    </p>
                  </div>
                </div>

                {/* Direct Turn ON / Turn OFF Action Buttons */}
                <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePower?.(app);
                    }}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                      isOn
                        ? "bg-rose-600 hover:bg-rose-500 text-white"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {isOn ? "Turn OFF" : "Turn ON"}
                  </button>

                  {app.id === "fan_table" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCycleFanSpeed?.(app);
                      }}
                      className="py-2 px-2.5 rounded-lg bg-cyan-900/70 hover:bg-cyan-800 text-cyan-200 text-xs font-semibold flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Speed ({app.fanSpeed}/4)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Smart Home Appliances & Default Gesture Controls
          </h3>
          <p className="text-xs text-slate-400">
            Click <strong>Turn ON / Turn OFF</strong> on any card for immediate actuation, or hold its assigned default hand gesture in the camera view.
          </p>
        </div>
        <span className="text-xs text-cyan-400 font-mono">Connected Digital Twin Bus</span>
      </div>

      {renderSection(
        "R0",
        "Tier R0 — Low Risk (Instant Gesture & Button Control)",
        "bg-emerald-950 text-emerald-400 border border-emerald-800",
        "Study Turbo Breeze Fan (✋ OPEN_PALM) & Reading Lamp (☝️ POINTING_UP)",
        r0Appliances
      )}

      {renderSection(
        "R1",
        "Tier R1 — Moderate Risk (Climate, Blinds & Media)",
        "bg-blue-950 text-blue-400 border border-blue-800",
        "Living Room AC (✌️ VICTORY), Privacy Blinds (👌 PINCH) & Smart TV (👎 THUMBS_DOWN)",
        r1Appliances
      )}

      {renderSection(
        "R2",
        "Tier R2 — High Power / Security Appliances",
        "bg-rose-950 text-rose-400 border border-rose-800",
        "Space Heater & Water Geyser (👍 THUMBS_UP), Main Entrance Deadbolt (✊ FIST)",
        r2Appliances
      )}
    </div>
  );
};
