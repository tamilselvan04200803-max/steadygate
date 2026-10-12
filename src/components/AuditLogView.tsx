"use client";

import React, { useState } from "react";
import { ActuationLogItem, RejectCode } from "@/lib/types";
import {
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  Trash2,
  ShieldAlert,
  ArrowUpRight,
} from "lucide-react";

interface AuditLogViewProps {
  logs: ActuationLogItem[];
  onClearLogs: () => void;
  calibrationEvents?: Array<{
    id: string;
    userId: string;
    previousAmplitude: number;
    newAmplitude: number;
    f0Hz: number;
    reason: string;
    createdAt: string;
  }>;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({
  logs,
  onClearLogs,
  calibrationEvents = [],
}) => {
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [selectedLog, setSelectedLog] = useState<ActuationLogItem | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (filterStatus === "ALL") return true;
    return log.status === filterStatus;
  });

  const getRejectCodeBadge = (code: RejectCode) => {
    switch (code) {
      case "TREMOR_EXCEEDS_PROFILE":
        return "bg-purple-950 text-purple-300 border-purple-800";
      case "LOW_ATTENTION":
        return "bg-blue-950 text-blue-300 border-blue-800";
      case "AMBIGUOUS_CLASS":
        return "bg-amber-950 text-amber-300 border-amber-800";
      case "POOR_LIGHT":
        return "bg-yellow-950 text-yellow-300 border-yellow-800";
      case "GESTURE_UNSTABLE":
        return "bg-rose-950 text-rose-300 border-rose-800";
      default:
        return "bg-slate-800 text-slate-400 border-slate-700";
    }
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-cyan-400" />
            Explainable Rejection & Self-Calibration Audit Trail (F5)
          </h3>
          <p className="text-xs text-slate-400">
            Every actuation and refusal emits a machine-readable reason code; retries trigger closed-loop profile nudging.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* Status Filter */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
            {["ALL", "ACTUATED", "REJECTED", "HANDSHAKE_PENDING"].map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`px-2 py-1 rounded text-[11px] transition-colors ${
                  filterStatus === status
                    ? "bg-slate-800 text-white font-medium"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <button
            onClick={onClearLogs}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
            title="Clear Log History"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Closed-loop calibration nudge events notice */}
      {calibrationEvents.length > 0 && (
        <div className="my-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/50 flex items-start gap-2 text-xs">
          <Sparkles className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-cyan-200">
              Active Closed-Loop Self-Calibration (F5 Weak Supervision):
            </span>
            <p className="text-cyan-300/80 text-[11px] mt-0.5">
              Latest event: {calibrationEvents[0].reason} — Baseline amplitude adjusted from{" "}
              {calibrationEvents[0].previousAmplitude} to {calibrationEvents[0].newAmplitude} RMS.
            </p>
          </div>
        </div>
      )}

      {/* Main Table / List */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase font-mono">
              <th className="py-2 px-2.5">Time</th>
              <th className="py-2 px-2.5">Target Appliance</th>
              <th className="py-2 px-2.5">User</th>
              <th className="py-2 px-2.5">Mode</th>
              <th className="py-2 px-2.5">Decision</th>
              <th className="py-2 px-2.5">Reason Code</th>
              <th className="py-2 px-2.5">Intent</th>
              <th className="py-2 px-2.5">Dwell</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono">
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500 font-sans">
                  No actuation records found. Trigger an appliance command to view audit telemetry.
                </td>
              </tr>
            ) : (
              filteredLogs.map((log) => {
                const isActuated = log.status === "ACTUATED";
                const isPending = log.status === "HANDSHAKE_PENDING";

                return (
                  <tr
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="hover:bg-slate-800/40 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-2.5 text-slate-400 text-[11px]">
                      {new Date(log.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-2.5 font-sans font-medium text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                            log.riskTier === "R2"
                              ? "bg-rose-950 text-rose-400 border border-rose-900"
                              : log.riskTier === "R1"
                              ? "bg-blue-950 text-blue-400 border border-blue-900"
                              : "bg-emerald-950 text-emerald-400 border border-emerald-900"
                          }`}
                        >
                          {log.riskTier}
                        </span>
                        {log.applianceName}
                      </div>
                    </td>
                    <td className="py-2.5 px-2.5 text-slate-300 font-sans text-[11px]">
                      {log.userName}
                    </td>
                    <td className="py-2.5 px-2.5 text-[10px]">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          log.baselineMode === "STEADYGATE"
                            ? "bg-cyan-950 text-cyan-300 border border-cyan-800"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {log.baselineMode}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isActuated
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                            : isPending
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                        }`}
                      >
                        {isActuated ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : isPending ? (
                          <Clock className="w-3 h-3" />
                        ) : (
                          <ShieldAlert className="w-3 h-3" />
                        )}
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-2.5">
                      {log.rejectCode !== "NONE" ? (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded border ${getRejectCodeBadge(
                            log.rejectCode as RejectCode
                          )}`}
                        >
                          {log.rejectCode}
                        </span>
                      ) : log.calibratedNudge ? (
                        <span className="text-[10px] text-cyan-300 font-sans flex items-center gap-1 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800">
                          <Sparkles className="w-3 h-3 text-cyan-400" />
                          Self-Calibrated (+4%)
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-2.5 text-slate-200">
                      {(log.intentScore * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 px-2.5 text-slate-400 text-[11px]">
                      {log.dwellTimeMs}/{log.dwellRequiredMs} ms
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Inspector Drawer / Modal */}
      {selectedLog && (
        <div className="mt-4 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 flex items-center gap-2">
              <ArrowUpRight className="w-4 h-4 text-cyan-400" />
              Actuation Telemetry Inspector: {selectedLog.id}
            </span>
            <button
              onClick={() => setSelectedLog(null)}
              className="text-slate-400 hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] mb-3">
            <div className="bg-slate-900 p-2 rounded">
              <span className="text-slate-500">Posterior P:</span>{" "}
              <span className="text-cyan-400">{(selectedLog.posterior * 100).toFixed(0)}%</span>
            </div>
            <div className="bg-slate-900 p-2 rounded">
              <span className="text-slate-500">Margin:</span>{" "}
              <span className="text-indigo-400">{(selectedLog.margin * 100).toFixed(0)}%</span>
            </div>
            <div className="bg-slate-900 p-2 rounded">
              <span className="text-slate-500">Attention:</span>{" "}
              <span className="text-blue-400">{(selectedLog.attention * 100).toFixed(0)}%</span>
            </div>
            <div className="bg-slate-900 p-2 rounded">
              <span className="text-slate-500">S_norm:</span>{" "}
              <span className="text-purple-400">{(selectedLog.stabilityNorm * 100).toFixed(0)}%</span>
            </div>
          </div>

          <p className="text-slate-300 font-sans">
            <strong>Target Command:</strong> <code className="text-cyan-300">{selectedLog.targetCommand}</code>
          </p>
          {selectedLog.rejectCode !== "NONE" && (
            <p className="text-rose-400 mt-1 font-sans">
              <strong>Refusal Reason:</strong> Machine-readable trigger <code>{selectedLog.rejectCode}</code>.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
