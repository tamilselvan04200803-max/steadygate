"use client";

import React from "react";
import { Appliance, RiskTier } from "@/lib/types";
import {
  Flame,
  Droplets,
  Lock,
  Lamp,
  Fan,
  Wind,
  Blinds,
  Tv,
  AlertOctagon,
  CheckCircle,
  Zap,
} from "lucide-react";

interface ApplianceCardGridProps {
  appliances: Appliance[];
  selectedAppliance: Appliance | null;
  onSelectAppliance: (appliance: Appliance) => void;
  onTogglePower?: (id: string, currentState: string) => void;
}

export const ApplianceCardGrid: React.FC<ApplianceCardGridProps> = ({
  appliances,
  selectedAppliance,
  onSelectAppliance,
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

            return (
              <div
                key={app.id}
                onClick={() => onSelectAppliance(app)}
                className={`relative rounded-xl p-3.5 border transition-all cursor-pointer select-none ${
                  isSelected
                    ? "bg-slate-900 border-cyan-500 ring-2 ring-cyan-500/20 shadow-lg shadow-cyan-950/50"
                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90"
                }`}
              >
                {/* Active Indicator Pin */}
                {isSelected && (
                  <div className="absolute -top-1.5 -right-1.5 bg-cyan-500 text-slate-950 rounded-full p-0.5 shadow-md">
                    <CheckCircle className="w-3.5 h-3.5 fill-cyan-500 text-slate-950" />
                  </div>
                )}

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

                  {/* Power State Badge */}
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

                {/* State Value */}
                <div className="mt-2.5 flex items-center justify-between text-xs text-slate-300">
                  <span className="text-slate-400 text-[11px]">Command Value:</span>
                  <span className="font-mono font-semibold">
                    {app.targetValue} {app.unit}
                  </span>
                </div>

                {/* Hazard Warning Callout */}
                <div className="mt-2 pt-2 border-t border-slate-800/80">
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {app.hazardDescription}
                  </p>
                </div>

                {/* R2 Handshake Notice */}
                {app.requiresHandshake && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-rose-400 font-semibold bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/50">
                    <AlertOctagon className="w-3 h-3 text-rose-400" />
                    Mandatory R2 Two-Gesture Confirmation
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Absolute-State Physical Appliance Grid (F6)
          </h3>
          <p className="text-xs text-slate-400">
            Click any device to target gesture gating. Commands use SET with UUID and relay ACK.
          </p>
        </div>
        <span className="text-xs text-cyan-400 font-mono">ESP32 / MQTT Emulation</span>
      </div>

      {renderSection(
        "R0",
        "Tier R0 — Low Risk (Fast Dwell)",
        "bg-emerald-950 text-emerald-400 border border-emerald-800",
        "Safe actuators; minimal physical consequence; instantaneous actuation.",
        r0Appliances
      )}

      {renderSection(
        "R1",
        "Tier R1 — Moderate Risk (Adaptive Dwell)",
        "bg-blue-950 text-blue-400 border border-blue-800",
        "High acoustic / privacy / thermal load. Gated by uncertainty.",
        r1Appliances
      )}

      {renderSection(
        "R2",
        "Tier R2 — Critical Hazard (Escalated Dwell + Two-Gesture Handshake)",
        "bg-rose-950 text-rose-400 border border-rose-800",
        "Fire, scald, or perimeter breach hazard. Enforces secondary handshake.",
        r2Appliances
      )}
    </div>
  );
};
