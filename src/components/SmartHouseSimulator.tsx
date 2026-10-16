"use client";

import React from "react";
import { Appliance } from "@/lib/types";
import { APPLIANCE_DEFAULT_GESTURE_LABEL } from "@/lib/default-gesture-map";
import {
  Lamp,
  Wind,
  Blinds,
  Tv,
  Flame,
  Droplets,
  Lock,
  Power,
  Sun,
  Gauge,
  Thermometer,
  ShieldAlert,
  Zap,
  Home,
} from "lucide-react";

interface SmartHouseSimulatorProps {
  appliances: Appliance[];
  selectedAppliance: Appliance | null;
  onSelectAppliance: (appliance: Appliance) => void;
  onDirectUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onNavigateToController: (appliance: Appliance) => void;
}

export const SmartHouseSimulator: React.FC<SmartHouseSimulatorProps> = ({
  appliances,
  selectedAppliance,
  onSelectAppliance,
  onDirectUpdate,
  onNavigateToController,
}) => {
  const getApp = (id: string) => appliances.find((a) => a.id === id);

  const lamp = getApp("lamp_desk");
  const fan = getApp("fan_table");
  const ac = getApp("ac_living");
  const blinds = getApp("blinds_window");
  const tv = getApp("tv_ambient");
  const heater = getApp("heater_radiant");
  const geyser = getApp("geyser_bath");
  const deadbolt = getApp("door_deadbolt");

  const totalWattage = appliances.reduce(
    (sum, a) => sum + (a.powerState === "ON" ? a.activeWattage || 0 : 0),
    0
  );
  const activeCount = appliances.filter((a) => a.powerState === "ON").length;

  const fanSpeed = fan?.powerState === "ON" ? Math.max(1, fan?.fanSpeed || 2) : 0;
  const fanRpm = fan?.powerState === "ON" ? fan?.airRpm || 420 + fanSpeed * 260 : 0;
  const fanPeriodS = fanRpm > 0 ? Math.max(0.18, Number((60 / fanRpm).toFixed(3))) : 0;

  return (
    <div className="space-y-6">
      {/* Top House Telemetry Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Home className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Room-by-Room Smart House Simulator
              </h2>
              <p className="text-xs text-slate-400">
                Connected directly to live gesture actuation & dashboard state. Every appliance has direct Turn ON / Turn OFF controls.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-right">
              <span className="text-[10px] text-slate-400 uppercase block">Active Devices</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {activeCount} / {appliances.length} ONLINE
              </span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg px-3.5 py-2 text-right">
              <span className="text-[10px] text-slate-400 uppercase block">Live Load Draw</span>
              <span className="text-sm font-mono font-bold text-amber-400 flex items-center justify-end gap-1">
                <Zap className="w-3.5 h-3.5" />
                {totalWattage.toFixed(0)} W
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Floorplan Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ROOM 1: STUDY ROOM (Lamp + Turbo Breeze Fan) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 relative overflow-hidden">
          {lamp?.powerState === "ON" && (
            <div
              className="pointer-events-none absolute -top-16 -left-16 w-72 h-72 rounded-full blur-3xl transition-opacity duration-500"
              style={{
                background: `radial-gradient(circle, rgba(251,191,36,${
                  (lamp.brightness || 80) / 220
                }) 0%, rgba(0,0,0,0) 70%)`,
              }}
            />
          )}

          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800 relative z-10">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
                Zone 01 · Study Room (R0 Instant)
              </span>
              <h3 className="text-sm font-bold text-slate-100">
                Desk Lighting & Turbo Breeze Fan
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {(lamp?.activeWattage || 0) + (fan?.activeWattage || 0)} W
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
            {/* LAMP SIMULATOR WIDGET */}
            {lamp && (
              <div
                onClick={() => onSelectAppliance(lamp)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedAppliance?.id === lamp.id
                    ? "bg-slate-950/90 border-amber-500/60 ring-1 ring-amber-500/30"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`p-2.5 rounded-xl transition-all ${
                        lamp.powerState === "ON"
                          ? "bg-amber-400/20 text-amber-300 shadow-lg shadow-amber-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Lamp className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{lamp.name}</h4>
                      <span className="text-[10px] text-cyan-400 font-mono">
                        {APPLIANCE_DEFAULT_GESTURE_LABEL[lamp.id]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDirectUpdate(lamp.id, {
                        powerState: lamp.powerState === "ON" ? "OFF" : "ON",
                      });
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${
                      lamp.powerState === "ON"
                        ? "bg-amber-500 text-slate-950"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {lamp.powerState === "ON" ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Visual Bulb Dome */}
                <div className="my-3 h-24 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col items-center justify-center relative overflow-hidden">
                  <div
                    className="w-14 h-14 rounded-full transition-all duration-300 flex items-center justify-center"
                    style={{
                      backgroundColor:
                        lamp.powerState === "ON"
                          ? `rgba(251, 191, 36, ${Math.max(0.2, (lamp.brightness || 80) / 100)})`
                          : "rgba(30, 41, 59, 0.6)",
                      boxShadow:
                        lamp.powerState === "ON"
                          ? `0 0 ${(lamp.brightness || 80) * 0.45}px rgba(251, 191, 36, 0.75)`
                          : "none",
                    }}
                  >
                    <Sun
                      className={`w-6 h-6 ${
                        lamp.powerState === "ON" ? "text-slate-950" : "text-slate-600"
                      }`}
                    />
                  </div>
                  <span className="mt-1.5 text-[11px] font-mono text-amber-300">
                    {lamp.powerState === "ON"
                      ? `${lamp.brightness}% Luminous Flux (${lamp.activeWattage}W)`
                      : "Lamp Off (0 lm)"}
                  </span>
                </div>

                {/* Brightness Control */}
                <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Dimmer Level</span>
                    <span className="font-mono text-amber-400">{lamp.brightness}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={lamp.brightness || 0}
                    onChange={(e) =>
                      onDirectUpdate(lamp.id, { brightness: Number(e.target.value) })
                    }
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* FAN SIMULATOR WIDGET (SVG Hub-Centered Rotor) */}
            {fan && (
              <div
                onClick={() => onSelectAppliance(fan)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  selectedAppliance?.id === fan.id
                    ? "bg-slate-950/90 border-cyan-500/60 ring-1 ring-cyan-500/30"
                    : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <div
                      className={`p-2.5 rounded-xl transition-all ${
                        fan.powerState === "ON"
                          ? "bg-cyan-500/20 text-cyan-300 shadow-lg shadow-cyan-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Gauge className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{fan.name}</h4>
                      <span className="text-[10px] text-cyan-400 font-mono">
                        {APPLIANCE_DEFAULT_GESTURE_LABEL[fan.id]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDirectUpdate(fan.id, {
                        powerState: fan.powerState === "ON" ? "OFF" : "ON",
                      });
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors ${
                      fan.powerState === "ON"
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {fan.powerState === "ON" ? "ON" : "OFF"}
                  </button>
                </div>

                {/* Precision Hub-Centered SVG Fan Rotor */}
                <div className="my-3 h-24 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col items-center justify-center">
                  <svg width="64" height="64" viewBox="0 0 64 64">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill={fan.powerState === "ON" ? "rgba(6, 182, 212, 0.12)" : "none"}
                      stroke={fan.powerState === "ON" ? "#22d3ee" : "#334155"}
                      strokeWidth="2"
                    />
                    <g>
                      {fan.powerState === "ON" && fanPeriodS > 0 && (
                        <animateTransform
                          attributeName="transform"
                          attributeType="XML"
                          type="rotate"
                          from="0 32 32"
                          to="360 32 32"
                          dur={`${fanPeriodS}s`}
                          repeatCount="indefinite"
                        />
                      )}
                      {[0, 90, 180, 270].map((deg) => (
                        <g key={deg} transform={`rotate(${deg} 32 32)`}>
                          <path
                            d="M 32 27 C 39 21, 41 9, 33 6 C 27 8, 26 19, 32 27 Z"
                            fill={fan.powerState === "ON" ? "#22d3ee" : "#475569"}
                          />
                        </g>
                      ))}
                      <circle
                        cx="32"
                        cy="32"
                        r="5"
                        fill={fan.powerState === "ON" ? "#ecfeff" : "#64748b"}
                      />
                    </g>
                  </svg>
                  <span className="mt-1 text-[11px] font-mono text-cyan-300 flex items-center gap-1">
                    <Gauge className="w-3 h-3" />
                    {fan.powerState === "ON"
                      ? `Speed ${fan.fanSpeed} · ${fanRpm} RPM`
                      : "Rotor Stopped (0 RPM)"}
                  </span>
                </div>

                {/* 5-Stage Speed Selector */}
                <div className="grid grid-cols-5 gap-1" onClick={(e) => e.stopPropagation()}>
                  {[0, 1, 2, 3, 4].map((spd) => (
                    <button
                      key={spd}
                      onClick={() => onDirectUpdate(fan.id, { fanSpeed: spd })}
                      className={`py-1 rounded text-[11px] font-mono font-bold transition-all ${
                        (fan.powerState === "OFF" ? 0 : fan.fanSpeed) === spd
                          ? "bg-cyan-500 text-slate-950 shadow"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                      }`}
                    >
                      {spd === 0 ? "OFF" : `S${spd}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ROOM 2: LIVING ROOM (AC, Motorized Blinds, Smart Display TV) */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400">
                Zone 02 · Living Room (R1 Standard Dwell)
              </span>
              <h3 className="text-sm font-bold text-slate-100">
                Climate Control, Privacy Blinds & Media
              </h3>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {(ac?.activeWattage || 0) +
                (blinds?.activeWattage || 0) +
                (tv?.activeWattage || 0)}{" "}
              W
            </span>
          </div>

          <div className="space-y-3">
            {/* AC UNIT */}
            {ac && (
              <div
                onClick={() => onSelectAppliance(ac)}
                className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
              >
                <div className="flex items-center space-x-3">
                  <div
                    className={`p-2.5 rounded-xl ${
                      ac.powerState === "ON"
                        ? "bg-sky-500/20 text-sky-400"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    <Wind className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-100">{ac.name}</h4>
                    <span className="text-[11px] font-mono text-sky-400">
                      {ac.powerState === "ON"
                        ? `Cooling to ${ac.temperature}°C (${ac.activeWattage}W)`
                        : "Compressor Idle"}{" "}
                      · {APPLIANCE_DEFAULT_GESTURE_LABEL[ac.id]}
                    </span>
                  </div>
                </div>

                <div
                  className="flex items-center space-x-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() =>
                      onDirectUpdate(ac.id, {
                        powerState: ac.powerState === "ON" ? "OFF" : "ON",
                      })
                    }
                    className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1 ${
                      ac.powerState === "ON"
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    <Power className="w-3 h-3" />
                    {ac.powerState}
                  </button>
                  <button
                    onClick={() =>
                      onDirectUpdate(ac.id, {
                        temperature: Math.max(16, (ac.temperature || 22) - 1),
                      })
                    }
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200"
                  >
                    -1°C
                  </button>
                  <span className="px-2 text-xs font-mono font-bold text-sky-300">
                    {ac.temperature}°C
                  </span>
                  <button
                    onClick={() =>
                      onDirectUpdate(ac.id, {
                        temperature: Math.min(30, (ac.temperature || 22) + 1),
                      })
                    }
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200"
                  >
                    +1°C
                  </button>
                </div>
              </div>
            )}

            {/* BLINDS & TV ROW */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {blinds && (
                <div
                  onClick={() => onSelectAppliance(blinds)}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2.5">
                    <Blinds
                      className={`w-5 h-5 ${
                        blinds.powerState === "ON" ? "text-indigo-400" : "text-slate-500"
                      }`}
                    />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{blinds.name}</h4>
                      <span className="text-[10px] font-mono text-indigo-300 block">
                        {blinds.powerState === "ON" ? "100% OPEN" : "CLOSED"} ·{" "}
                        {APPLIANCE_DEFAULT_GESTURE_LABEL[blinds.id]?.split(" ")[0]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDirectUpdate(blinds.id, {
                        powerState: blinds.powerState === "ON" ? "OFF" : "ON",
                      });
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                      blinds.powerState === "ON"
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {blinds.powerState === "ON" ? "Close" : "Open"}
                  </button>
                </div>
              )}

              {tv && (
                <div
                  onClick={() => onSelectAppliance(tv)}
                  className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 hover:border-slate-700 cursor-pointer flex items-center justify-between"
                >
                  <div className="flex items-center space-x-2.5">
                    <Tv
                      className={`w-5 h-5 ${
                        tv.powerState === "ON" ? "text-purple-400" : "text-slate-500"
                      }`}
                    />
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{tv.name}</h4>
                      <span className="text-[10px] font-mono text-purple-300 block">
                        {tv.powerState === "ON" ? `ON · Vol ${tv.targetValue}` : "OFF"} ·{" "}
                        {APPLIANCE_DEFAULT_GESTURE_LABEL[tv.id]?.split(" ")[0]}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDirectUpdate(tv.id, {
                        powerState: tv.powerState === "ON" ? "OFF" : "ON",
                      });
                    }}
                    className={`px-2.5 py-1 rounded text-[11px] font-bold ${
                      tv.powerState === "ON"
                        ? "bg-purple-600 text-white"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {tv.powerState === "ON" ? "Turn OFF" : "Turn ON"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ROOM 3: HIGH-POWER & SECURITY ZONE (Heater, Geyser, Deadbolt) */}
      <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-2 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-rose-400 block">
                Zone 03 · High-Risk / Security Zone (Tier R2)
              </span>
              <h3 className="text-sm font-bold text-slate-100">
                Thermal Appliances & Entrance Deadbolt (Direct Toggle or Gesture Actuation)
              </h3>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[heater, geyser, deadbolt].map((app) => {
            if (!app) return null;
            const isOn = app.powerState === "ON";
            const IconComp =
              app.id === "heater_radiant"
                ? Flame
                : app.id === "geyser_bath"
                ? Droplets
                : Lock;

            return (
              <div
                key={app.id}
                onClick={() => onSelectAppliance(app)}
                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                  isOn
                    ? "bg-rose-950/30 border-rose-500/50"
                    : "bg-slate-950/70 border-slate-800 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg ${
                        isOn
                          ? "bg-rose-500/20 text-rose-400"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      <IconComp className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">{app.name}</h4>
                      <span className="text-[10px] text-cyan-400 font-mono">
                        {APPLIANCE_DEFAULT_GESTURE_LABEL[app.id]}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      isOn
                        ? "bg-rose-500 text-white"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {app.powerState}
                  </span>
                </div>

                <div className="text-xs font-mono text-slate-300 mb-3 flex items-center justify-between bg-slate-900/90 px-3 py-2 rounded-lg border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1">
                    <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                    Status:
                  </span>
                  <span>
                    {app.targetValue} {app.unit} ({app.activeWattage}W)
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDirectUpdate(app.id, {
                        powerState: isOn ? "OFF" : "ON",
                      });
                    }}
                    className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                      isOn
                        ? "bg-rose-600 hover:bg-rose-500 text-white"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    <Power className="w-3.5 h-3.5" />
                    {isOn ? "Turn OFF" : "Turn ON"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToController(app);
                    }}
                    className="py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                  >
                    Gate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
