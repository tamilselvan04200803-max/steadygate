"use client";

import React from "react";
import { UserProfile, BaselineMode } from "@/lib/types";
import {
  ShieldAlert,
  Activity,
  User,
  SlidersHorizontal,
  Sparkles,
  Shield,
  Bot,
} from "lucide-react";

interface HeaderProps {
  users: UserProfile[];
  selectedUser: UserProfile | null;
  onSelectUser: (user: UserProfile) => void;
  baselineMode: BaselineMode;
  onSelectBaselineMode: (mode: BaselineMode) => void;
  onOpenEnrolment: () => void;
  isSimulating: boolean;
  appMode: "USER" | "ADMIN";
  onAppModeChange: (mode: "USER" | "ADMIN") => void;
  agentAlertCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  users,
  selectedUser,
  onSelectUser,
  baselineMode,
  onSelectBaselineMode,
  onOpenEnrolment,
  appMode,
  onAppModeChange,
  agentAlertCount = 0,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-40 px-4 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Brand & Tagline */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Activity className="w-5 h-5 text-white animate-pulse" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                SteadyGate
                <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800 font-mono">
                  RHG-Home v3
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              Tremor-Aware Intent Gating · Multi-Agent AI Debug Council · Smart-Home IoT
            </p>
          </div>
        </div>

        {/* Top Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* USER / ADMIN mode */}
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg p-1 text-xs">
            <button
              onClick={() => onAppModeChange("USER")}
              className={`px-2.5 py-1.5 rounded font-semibold flex items-center gap-1 transition-all ${
                appMode === "USER"
                  ? "bg-slate-100 text-slate-900 shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <User className="w-3.5 h-3.5" />
              User Mode
            </button>
            <button
              onClick={() => onAppModeChange("ADMIN")}
              className={`px-2.5 py-1.5 rounded font-semibold flex items-center gap-1 transition-all relative ${
                appMode === "ADMIN"
                  ? "bg-amber-500 text-slate-950 shadow-sm"
                  : "text-amber-300/80 hover:text-amber-200"
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              Admin Mode
              {agentAlertCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center border border-slate-950">
                  {agentAlertCount > 99 ? "99+" : agentAlertCount}
                </span>
              )}
            </button>
          </div>

          {appMode === "USER" && (
            <>
              {/* Baseline Mode Switcher */}
              <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
                <span className="text-slate-400 px-2 flex items-center gap-1 font-medium">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                  Gate:
                </span>
                <button
                  onClick={() => onSelectBaselineMode("STEADYGATE")}
                  className={`px-2.5 py-1 rounded font-semibold transition-all ${
                    baselineMode === "STEADYGATE"
                      ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  SteadyGate
                </button>
                <button
                  onClick={() => onSelectBaselineMode("B0_RAW")}
                  className={`px-2 py-1 rounded transition-all ${
                    baselineMode === "B0_RAW"
                      ? "bg-amber-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Baseline B0"
                >
                  B0
                </button>
                <button
                  onClick={() => onSelectBaselineMode("B1_WAKE_STATE")}
                  className={`px-2 py-1 rounded transition-all ${
                    baselineMode === "B1_WAKE_STATE"
                      ? "bg-amber-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Baseline B1"
                >
                  B1
                </button>
                <button
                  onClick={() => onSelectBaselineMode("B2_FIXED_DWELL")}
                  className={`px-2 py-1 rounded transition-all ${
                    baselineMode === "B2_FIXED_DWELL"
                      ? "bg-amber-600 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="Baseline B2"
                >
                  B2
                </button>
              </div>

              {/* Active User Selector */}
              <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                <select
                  aria-label="Active User Profile"
                  value={selectedUser?.id || ""}
                  onChange={(e) => {
                    const found = users.find((u) => u.id === e.target.value);
                    if (found) onSelectUser(found);
                  }}
                  className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer"
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id} className="bg-slate-900 text-slate-200">
                      {u.name} ({u.f0Hz} Hz)
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={onOpenEnrolment}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-medium transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                10-s Enrolment
              </button>
            </>
          )}

          {appMode === "ADMIN" && (
            <div className="flex items-center gap-2 text-xs text-amber-200/90 bg-amber-950/40 border border-amber-800/50 px-3 py-1.5 rounded-lg">
              <Bot className="w-3.5 h-3.5 text-amber-400" />
              Multi-agent council visible · continuous deep analysis armed
            </div>
          )}
        </div>
      </div>

      {/* Mode Alert Banner if not SteadyGate */}
      {appMode === "USER" && baselineMode !== "STEADYGATE" && (
        <div className="max-w-7xl mx-auto mt-2 px-3 py-1.5 rounded bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span>
              <strong>Evaluating Prior-Art Baseline ({baselineMode}):</strong> Tremor normalization
              and R2 handshake protections may be reduced.
            </span>
          </div>
          <button
            onClick={() => onSelectBaselineMode("STEADYGATE")}
            className="underline text-amber-200 font-semibold hover:text-white ml-3"
          >
            Switch to SteadyGate
          </button>
        </div>
      )}
    </header>
  );
};
