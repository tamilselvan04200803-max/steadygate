"use client";

import React, { useState } from "react";
import { Appliance, RecognizedGesture } from "@/lib/types";
import {
  Fan,
  Wind,
  Lamp,
  Tv,
  Flame,
  Droplets,
  Lock,
  Blinds,
  Zap,
  Activity,
  Thermometer,
  Gauge,
  Radio,
  Sliders,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

interface SmartHouseSimulatorProps {
  appliances: Appliance[];
  selectedAppliance: Appliance | null;
  onSelectAppliance: (app: Appliance) => void;
  onUpdateAppliance: (params: {
    id: string;
    powerState?: string;
    fanSpeed?: number;
    temperature?: number;
    brightness?: number;
  }) => Promise<void>;
  lastMqttMessage?: {
    topic: string;
    payload: Record<string, unknown>;
    qos: number;
    gpioPin: number;
    roundTripMs: number;
  } | null;
  currentRecognizedGesture?: RecognizedGesture;
}

export const SmartHouseSimulator: React.FC<SmartHouseSimulatorProps> = ({
  appliances,
  selectedAppliance,
  onSelectAppliance,
  onUpdateAppliance,
  lastMqttMessage,
  currentRecognizedGesture,
}) => {
  const [selectedRoom, setSelectedRoom] = useState<string>("ALL");

  // Helper getters
  const lamp = appliances.find((a) => a.id === "lamp_desk");
  const fan = appliances.find((a) => a.id === "fan_table");
  const ac = appliances.find((a) => a.id === "ac_living");
  const tv = appliances.find((a) => a.id === "tv_ambient");
  const blinds = appliances.find((a) => a.id === "blinds_window");
  const heater = appliances.find((a) => a.id === "heater_radiant");
  const geyser = appliances.find((a) => a.id === "geyser_bath");
  const deadbolt = appliances.find((a) => a.id === "door_deadbolt");

  // Total household wattage calculation
  const totalPowerW = appliances.reduce(
    (acc, a) => acc + (a.powerState === "ON" ? a.activeWattage || 0 : 0),
    0
  );

  const activeCount = appliances.filter((a) => a.powerState === "ON").length;

  return (
    <div className="space-y-6">
      {/* Top House Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium">Total Smart Power</span>
            <div className="text-xl font-extrabold font-mono text-cyan-400 mt-0.5">
              {totalPowerW.toFixed(0)} <span className="text-xs text-slate-400 font-normal">W</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              {(totalPowerW / 1000).toFixed(2)} kW instantaneous
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center">
            <Zap className="w-5 h-5 text-cyan-400" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium">Indoor Climate</span>
            <div className="text-xl font-extrabold font-mono text-blue-400 mt-0.5">
              {ac?.powerState === "ON" ? `${ac.temperature || 22}°C` : "24.5°C"}
            </div>
            <span className="text-[10px] text-slate-500">
              AC: {ac?.powerState || "OFF"} | Fan: Spd {fan?.fanSpeed || 0}
            </span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-950/80 border border-blue-800/60 flex items-center justify-center">
            <Thermometer className="w-5 h-5 text-blue-400" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium">Active IoT Relays</span>
            <div className="text-xl font-extrabold font-mono text-emerald-400 mt-0.5">
              {activeCount} / {appliances.length}
            </div>
            <span className="text-[10px] text-slate-500">ESP32 GPIO Mesh Active</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center">
            <Radio className="w-5 h-5 text-emerald-400 animate-pulse" />
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400 font-medium">Perimeter Security</span>
            <div className="text-xl font-extrabold font-mono text-rose-400 mt-0.5">
              {deadbolt?.powerState === "ON" ? "ARMED / LOCKED" : "UNLATCHED"}
            </div>
            <span className="text-[10px] text-slate-500">R2 Handshake Perimeter</span>
          </div>
          <div className="w-10 h-10 rounded-lg bg-rose-950/80 border border-rose-800/60 flex items-center justify-center">
            <Lock className="w-5 h-5 text-rose-400" />
          </div>
        </div>
      </div>

      {/* Room Filter Toolbar & Gesture Indicator */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center space-x-1 overflow-x-auto text-xs">
          <span className="text-slate-400 mr-2 flex items-center gap-1 font-medium">
            <Sliders className="w-3.5 h-3.5" /> Rooms:
          </span>
          {["ALL", "STUDY ROOM", "LIVING ROOM", "MASTER BEDROOM", "BATHROOM & ENTRANCE"].map(
            (room) => (
              <button
                key={room}
                onClick={() => setSelectedRoom(room)}
                className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  selectedRoom === room
                    ? "bg-cyan-600 text-white font-medium shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                }`}
              >
                {room}
              </button>
            )
          )}
        </div>

        {currentRecognizedGesture && currentRecognizedGesture !== "UNKNOWN" && (
          <div className="flex items-center gap-2 bg-slate-950 px-3 py-1 rounded-lg border border-cyan-800/60 text-xs text-cyan-300">
            <span className="text-slate-400">Live Gesture:</span>
            <span className="font-mono font-bold text-white bg-cyan-900/80 px-2 py-0.5 rounded">
              {currentRecognizedGesture}
            </span>
          </div>
        )}
      </div>

      {/* Interactive Smart House Floorplan Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ROOM 1: STUDY ROOM (Reading Lamp & Turbo Breeze Fan) */}
        {(selectedRoom === "ALL" || selectedRoom === "STUDY ROOM") && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            {/* Ambient Room Lighting Glow when Lamp is ON */}
            {lamp?.powerState === "ON" && (
              <div
                className="absolute inset-0 pointer-events-none transition-opacity duration-500"
                style={{
                  background:
                    "radial-gradient(circle at 30% 35%, rgba(251, 191, 36, 0.18) 0%, transparent 65%)",
                }}
              />
            )}

            <div className="flex items-center justify-between pb-3 border-b border-slate-800 relative z-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
                <h3 className="text-sm font-bold text-slate-100">Study Room</h3>
              </div>
              <span className="text-xs font-mono text-slate-400">Zone 1 — Work & Reading</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 relative z-10">
              {/* APPLIANCE 1: Study Reading Lamp */}
              <div
                onClick={() => lamp && onSelectAppliance(lamp)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "lamp_desk"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        lamp?.powerState === "ON"
                          ? "bg-amber-500/20 text-amber-300 shadow-lg shadow-amber-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Lamp className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{lamp?.name}</h4>
                      <span className="text-[10px] text-slate-400">R0 Low-Risk LED</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      lamp?.powerState === "ON"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {lamp?.powerState}
                  </span>
                </div>

                {/* Visual Lamp Cone Illumination Graphic */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col items-center justify-center relative overflow-hidden">
                  {lamp?.powerState === "ON" ? (
                    <>
                      <div className="w-16 h-8 rounded-t-full bg-amber-400/30 border-t border-amber-300 animate-pulse shadow-xl" />
                      <div
                        className="w-32 h-10 transition-all duration-300"
                        style={{
                          background:
                            "linear-gradient(to bottom, rgba(251, 191, 36, 0.35), transparent)",
                        }}
                      />
                      <span className="text-[11px] font-mono text-amber-300 font-bold z-10">
                        {lamp.brightness || 80}% Brightness ({(lamp.brightness || 80) * 5} Lux)
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-500 font-mono">Lamp OFF (Dark)</span>
                  )}
                </div>

                {/* Direct Action Toggle */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Gesture: ✋ OPEN_PALM</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (lamp) {
                        onUpdateAppliance({
                          id: lamp.id,
                          powerState: lamp.powerState === "ON" ? "OFF" : "ON",
                        });
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                  >
                    Toggle Power
                  </button>
                </div>
              </div>

              {/* APPLIANCE 2: Turbo Breeze Fan */}
              <div
                onClick={() => fan && onSelectAppliance(fan)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "fan_table"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        fan?.powerState === "ON"
                          ? "bg-cyan-500/20 text-cyan-300 shadow-lg shadow-cyan-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Fan
                        className={`w-5 h-5 ${
                          fan?.powerState === "ON"
                            ? fan.fanSpeed === 4
                              ? "animate-spin [animation-duration:0.35s]"
                              : fan.fanSpeed === 3
                              ? "animate-spin [animation-duration:0.6s]"
                              : fan.fanSpeed === 2
                              ? "animate-spin [animation-duration:1s]"
                              : "animate-spin [animation-duration:1.6s]"
                            : ""
                        }`}
                      />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{fan?.name}</h4>
                      <span className="text-[10px] text-slate-400">R0 Aerodynamic Fan</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      fan?.powerState === "ON"
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    Speed {fan?.fanSpeed || 0}
                  </span>
                </div>

                {/* Fan Telemetry Gauges (RPM & Airflow CFM) */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex items-center justify-around">
                  <div className="text-center">
                    <span className="text-[9px] text-slate-400 block uppercase">Rotational Speed</span>
                    <span className="text-sm font-extrabold font-mono text-cyan-300">
                      {fan?.airRpm || 0} <span className="text-[10px] font-normal">RPM</span>
                    </span>
                  </div>
                  <div className="w-px h-8 bg-slate-800" />
                  <div className="text-center">
                    <span className="text-[9px] text-slate-400 block uppercase">Airflow Vol</span>
                    <span className="text-sm font-extrabold font-mono text-cyan-300">
                      {fan?.airflowCfm || 0} <span className="text-[10px] font-normal">CFM</span>
                    </span>
                  </div>
                </div>

                {/* Direct Action: Cycle Speed */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Gesture: ✌️ VICTORY</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fan) {
                        const nextSpeed = ((fan.fanSpeed || 0) + 1) % 5;
                        onUpdateAppliance({
                          id: fan.id,
                          fanSpeed: nextSpeed,
                          powerState: nextSpeed === 0 ? "OFF" : "ON",
                        });
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-medium"
                  >
                    Cycle Speed (0-4)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROOM 2: LIVING ROOM (Dual-Inverter AC & Ambient TV) */}
        {(selectedRoom === "ALL" || selectedRoom === "LIVING ROOM") && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            {/* Cool Air Flow Gradient Overlay when AC is ON */}
            {ac?.powerState === "ON" && (
              <div
                className="absolute inset-0 pointer-events-none transition-opacity duration-500"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(56, 189, 248, 0.12) 0%, transparent 70%)",
                }}
              />
            )}

            <div className="flex items-center justify-between pb-3 border-b border-slate-800 relative z-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-400 animate-ping" />
                <h3 className="text-sm font-bold text-slate-100">Living Room</h3>
              </div>
              <span className="text-xs font-mono text-slate-400">Zone 2 — High Thermal / Media</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 relative z-10">
              {/* APPLIANCE 3: Dual-Inverter AC */}
              <div
                onClick={() => ac && onSelectAppliance(ac)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "ac_living"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        ac?.powerState === "ON"
                          ? "bg-blue-500/20 text-blue-300 shadow-lg shadow-blue-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Wind className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{ac?.name}</h4>
                      <span className="text-[10px] text-slate-400">R1 Dual Inverter</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      ac?.powerState === "ON"
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {ac?.powerState === "ON" ? `${ac.temperature || 22}°C` : "OFF"}
                  </span>
                </div>

                {/* Animated Cold Air Breeze Stream */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex flex-col justify-center relative overflow-hidden">
                  {ac?.powerState === "ON" ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[11px] font-mono">
                        <span className="text-slate-400">Setpoint Cooling:</span>
                        <span className="text-blue-300 font-bold">{ac.temperature || 22.0}°C</span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-cyan-400 to-blue-500 h-full animate-pulse"
                          style={{ width: "85%" }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>Air: {ac.airflowCfm || 410} CFM</span>
                        <span>Power: {ac.activeWattage || 1250} W</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center text-xs text-slate-500 font-mono">
                      Compressor Inactive
                    </div>
                  )}
                </div>

                {/* Direct Action: Step Temperature */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Gesture: ☝️ POINTING_UP</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (ac) {
                        const temps = [24, 22, 20, 18];
                        const curr = Math.round(ac.temperature || 22);
                        const next = temps[(temps.indexOf(curr) + 1) % temps.length];
                        onUpdateAppliance({
                          id: ac.id,
                          powerState: "ON",
                          temperature: next,
                        });
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-blue-300 text-[11px] font-medium"
                  >
                    Step Temp (°C)
                  </button>
                </div>
              </div>

              {/* APPLIANCE 4: Smart Display TV */}
              <div
                onClick={() => tv && onSelectAppliance(tv)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "tv_ambient"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        tv?.powerState === "ON"
                          ? "bg-purple-500/20 text-purple-300 shadow-lg shadow-purple-500/20"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Tv className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{tv?.name}</h4>
                      <span className="text-[10px] text-slate-400">R1 Media Display</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      tv?.powerState === "ON"
                        ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {tv?.powerState}
                  </span>
                </div>

                {/* Visual TV Screen Graphic */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-center relative overflow-hidden">
                  {tv?.powerState === "ON" ? (
                    <div className="w-full h-full bg-gradient-to-tr from-purple-900/60 to-indigo-900/40 flex flex-col items-center justify-center">
                      <span className="text-[11px] font-bold text-purple-200">
                        4K Ambient Dashboard
                      </span>
                      <span className="text-[10px] font-mono text-purple-300">
                        Vol: {tv.targetValue || 35}% | HDMI-1
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 font-mono">Display Standby</span>
                  )}
                </div>

                {/* Direct Action Toggle */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Gesture: ✋ OPEN_PALM</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (tv) {
                        onUpdateAppliance({
                          id: tv.id,
                          powerState: tv.powerState === "ON" ? "OFF" : "ON",
                        });
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-purple-300 text-[11px] font-medium"
                  >
                    Toggle TV
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROOM 3: MASTER BEDROOM (Radiant Quartz Heater & Privacy Blinds) */}
        {(selectedRoom === "ALL" || selectedRoom === "MASTER BEDROOM") && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            {/* Radiant Thermal Glow when Heater is ON */}
            {heater?.powerState === "ON" && (
              <div
                className="absolute inset-0 pointer-events-none transition-opacity duration-500"
                style={{
                  background:
                    "radial-gradient(circle at 70% 40%, rgba(244, 63, 94, 0.22) 0%, transparent 70%)",
                }}
              />
            )}

            <div className="flex items-center justify-between pb-3 border-b border-slate-800 relative z-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
                <h3 className="text-sm font-bold text-slate-100">Master Bedroom</h3>
              </div>
              <span className="text-xs font-mono text-rose-400 flex items-center gap-1 font-bold">
                <AlertTriangle className="w-3.5 h-3.5" /> R2 Safety Zone
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 relative z-10">
              {/* APPLIANCE 5: Radiant Quartz Space Heater (R2 CRITICAL HAZARD) */}
              <div
                onClick={() => heater && onSelectAppliance(heater)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "heater_radiant"
                    ? "border-rose-500 bg-slate-950/90 ring-2 ring-rose-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        heater?.powerState === "ON"
                          ? "bg-rose-500/20 text-rose-400 shadow-lg shadow-rose-500/30"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Flame className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{heater?.name}</h4>
                      <span className="text-[10px] text-rose-400 font-semibold">
                        R2 450°C Fire Risk
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      heater?.powerState === "ON"
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {heater?.powerState}
                  </span>
                </div>

                {/* Glowing Quartz Coils Graphic */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 flex flex-col items-center justify-center p-2 relative overflow-hidden">
                  {heater?.powerState === "ON" ? (
                    <div className="w-full space-y-1.5 text-center">
                      <div className="h-2.5 bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 rounded-full animate-pulse shadow-lg shadow-rose-500/50" />
                      <div className="h-2.5 bg-gradient-to-r from-amber-500 via-rose-500 to-amber-500 rounded-full animate-pulse shadow-lg shadow-rose-500/50" />
                      <span className="text-[10px] font-mono text-rose-300 font-bold block mt-1">
                        COILS ENERGIZED: 2000 W @ 450°C
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 font-mono">Coils Cold (Safe)</span>
                  )}
                </div>

                {/* Action notice */}
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[10px] text-rose-400">Requires R2 Handshake (👍)</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (heater) {
                        onSelectAppliance(heater);
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 text-[11px] font-medium border border-rose-800"
                  >
                    Arm Handshake
                  </button>
                </div>
              </div>

              {/* APPLIANCE 6: Motorized Blinds */}
              <div
                onClick={() => blinds && onSelectAppliance(blinds)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "blinds_window"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        blinds?.powerState === "ON"
                          ? "bg-indigo-500/20 text-indigo-300"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Blinds className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{blinds?.name}</h4>
                      <span className="text-[10px] text-slate-400">R1 Window Shutter</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      blinds?.powerState === "ON"
                        ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {blinds?.powerState === "ON" ? "OPEN" : "CLOSED"}
                  </span>
                </div>

                {/* Slat Animation Graphic */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex flex-col justify-around">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`h-1.5 rounded transition-all duration-300 ${
                        blinds?.powerState === "ON"
                          ? "bg-indigo-400/80 rotate-6"
                          : "bg-slate-700 rotate-0"
                      }`}
                    />
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Gesture: ✋ OPEN_PALM</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (blinds) {
                        onUpdateAppliance({
                          id: blinds.id,
                          powerState: blinds.powerState === "ON" ? "OFF" : "ON",
                        });
                      }
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-medium"
                  >
                    Toggle Blinds
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ROOM 4: BATHROOM & ENTRANCE (Water Geyser & Deadbolt Lock) */}
        {(selectedRoom === "ALL" || selectedRoom === "BATHROOM & ENTRANCE") && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl relative overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 relative z-10">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                <h3 className="text-sm font-bold text-slate-100">Bathroom & Front Entrance</h3>
              </div>
              <span className="text-xs font-mono text-slate-400">Zone 3 — Utilities & Security</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 relative z-10">
              {/* APPLIANCE 7: Water Geyser / Boiler */}
              <div
                onClick={() => geyser && onSelectAppliance(geyser)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "geyser_bath"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        geyser?.powerState === "ON"
                          ? "bg-sky-500/20 text-sky-400"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      <Droplets className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{geyser?.name}</h4>
                      <span className="text-[10px] text-slate-400">R2 Scald Protection</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      geyser?.powerState === "ON"
                        ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {geyser?.powerState === "ON" ? "HEATING" : "IDLE"}
                  </span>
                </div>

                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 p-2 flex items-center justify-around">
                  <div className="text-center">
                    <span className="text-[9px] text-slate-400 block uppercase">Water Temp</span>
                    <span className="text-base font-extrabold font-mono text-sky-300">
                      {geyser?.powerState === "ON" ? "65.0°C" : "38.5°C"}
                    </span>
                  </div>
                  <div className="w-px h-8 bg-slate-800" />
                  <div className="text-center">
                    <span className="text-[9px] text-slate-400 block uppercase">Coil Load</span>
                    <span className="text-base font-extrabold font-mono text-sky-300">
                      {geyser?.powerState === "ON" ? "3000 W" : "0 W"}
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[10px] text-rose-400">R2 Confirmation Required</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (geyser) onSelectAppliance(geyser);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[11px] font-medium"
                  >
                    Select Target
                  </button>
                </div>
              </div>

              {/* APPLIANCE 8: Deadbolt Smart Lock */}
              <div
                onClick={() => deadbolt && onSelectAppliance(deadbolt)}
                className={`p-4 rounded-xl border transition-all cursor-pointer relative ${
                  selectedAppliance?.id === "door_deadbolt"
                    ? "border-cyan-500 bg-slate-950/90 ring-2 ring-cyan-500/20"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-700"
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-2 rounded-lg transition-all ${
                        deadbolt?.powerState === "ON"
                          ? "bg-rose-500/20 text-rose-400"
                          : "bg-emerald-500/20 text-emerald-400"
                      }`}
                    >
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-200">{deadbolt?.name}</h4>
                      <span className="text-[10px] text-slate-400">R2 Physical Deadbolt</span>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      deadbolt?.powerState === "ON"
                        ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                        : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                    }`}
                  >
                    {deadbolt?.powerState === "ON" ? "LOCKED" : "UNLATCHED"}
                  </span>
                </div>

                {/* Deadbolt Latch Sliding Animation Graphic */}
                <div className="h-20 rounded-lg bg-slate-900 border border-slate-800/80 p-3 flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">Mechanical Strike:</span>
                  <div className="relative w-28 h-6 bg-slate-950 rounded-full border border-slate-800 flex items-center p-0.5">
                    <div
                      className={`h-4 rounded-full transition-all duration-500 flex items-center justify-center font-mono text-[9px] font-bold ${
                        deadbolt?.powerState === "ON"
                          ? "w-14 bg-rose-500 text-white ml-auto"
                          : "w-14 bg-emerald-500 text-slate-950"
                      }`}
                    >
                      {deadbolt?.powerState === "ON" ? "ENGAGED" : "OPEN"}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400">Emergency: ✊ FIST</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deadbolt) onSelectAppliance(deadbolt);
                    }}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium"
                  >
                    Select Target
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Real-time MQTT & ESP32 Telemetry Terminal */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs shadow-inner">
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-2 text-cyan-400">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span className="font-bold text-slate-200">
              Real-Time MQTT / ESP32 Hardware Bus Telemetry
            </span>
          </div>
          <span className="text-[10px] text-slate-500">Broker: mqtt://edge-broker.local:1883</span>
        </div>

        {lastMqttMessage ? (
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between text-slate-400">
              <span>
                Topic: <strong className="text-cyan-300">{lastMqttMessage.topic}</strong> (QoS{" "}
                {lastMqttMessage.qos})
              </span>
              <span className="text-emerald-400 flex items-center gap-1 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" /> ACK RTT: {lastMqttMessage.roundTripMs} ms
              </span>
            </div>
            <pre className="text-slate-300 bg-slate-900/90 p-2 rounded border border-slate-800 text-[10px] overflow-x-auto">
              {JSON.stringify(lastMqttMessage.payload, null, 2)}
            </pre>
            <span className="text-[10px] text-slate-500">
              Hardware Relay: ESP32 GPIO Pin {lastMqttMessage.gpioPin} | Optocoupler Isolated | Set
              Verified
            </span>
          </div>
        ) : (
          <p className="text-slate-500 text-[11px]">
            Ready. Perform any hand gesture or click an appliance to dispatch an absolute-state SET
            command over the MQTT message bus.
          </p>
        )}
      </div>
    </div>
  );
};
