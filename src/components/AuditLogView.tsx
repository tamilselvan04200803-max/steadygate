"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ActuationLogItem, RejectCode } from "@/lib/types";
import {
  FileText,
  CheckCircle2,
  Clock,
  Sparkles,
  Trash2,
  ShieldAlert,
  ArrowUpRight,
  Database,
  RefreshCw,
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
  const [userDataSnapshot, setUserDataSnapshot] = useState<any>(null);
  const [loadingUserData, setLoadingUserData] = useState(false);

  const fetchStoredUserData = useCallback(async () => {
    setLoadingUserData(true);
    try {
      const res = await fetch("/api/user-data?limit=50");
      const data = await res.json();
      setUserDataSnapshot(data);
    } catch (err) {
      console.error("Failed to fetch /api/user-data:", err);
    } finally {
      setLoadingUserData(false);
    }
  }, []);

  useEffect(() => {
    fetchStoredUserData();
    const timer = setInterval(fetchStoredUserData, 5000);
    return () => clearInterval(timer);
  }, [fetchStoredUserData]);

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
    <div className="space-y-6">
      {/* Persistent User Data Storage & Background Observation Logs Panel */}
      <div className="bg-slate-900/85 border border-cyan-500/30 rounded-xl p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Background Personalized User Data & On-Disk Storage Logs
              </h3>
              <p className="text-xs text-slate-400">
                Continuously observes user tremor kinematics, hand morphology, per-finger extension, and actuation behavior in the background and writes to disk.
              </p>
            </div>
          </div>

          <button
            onClick={fetchStoredUserData}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-300 font-medium flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingUserData ? "animate-spin" : ""}`} />
            <span>Refresh Storage</span>
          </button>
        </div>

        {/* Storage Artifact Paths */}
        {userDataSnapshot?.files && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-[11px] font-mono">
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[10px]">Personalized Profiles JSON</span>
              <span className="text-cyan-400 break-all">
                storage/users_personalized.json ({userDataSnapshot.personalizedProfilesCount || 0})
              </span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[10px]">Background Observations JSONL</span>
              <span className="text-emerald-400 break-all">
                logs/user_observations.jsonl ({userDataSnapshot.recentObservations?.length || 0})
              </span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[10px]">60s Enrolment History JSONL</span>
              <span className="text-purple-400 break-all">
                logs/enrolment_history.jsonl ({userDataSnapshot.enrolmentHistory?.length || 0})
              </span>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[10px]">Appliance & Actuation Logs</span>
              <span className="text-amber-400 break-all">
                logs/actuation_events.jsonl ({userDataSnapshot.actuationEvents?.length || 0})
              </span>
            </div>
          </div>
        )}

        {/* Recent Background User Observations Table */}
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-slate-300 mb-2">
            Latest Background User Observations (from <code>logs/user_observations.jsonl</code>)
          </h4>
          <div className="overflow-x-auto max-h-60 border border-slate-800 rounded-lg bg-slate-950">
            <table className="w-full text-left text-[11px] font-mono">
              <thead className="bg-slate-900 text-slate-400 uppercase sticky top-0">
                <tr>
                  <th className="py-2 px-2.5">Timestamp</th>
                  <th className="py-2 px-2.5">User</th>
                  <th className="py-2 px-2.5">Source</th>
                  <th className="py-2 px-2.5">Gesture</th>
                  <th className="py-2 px-2.5">Tremor Hz / Amp</th>
                  <th className="py-2 px-2.5">Palm / Spread</th>
                  <th className="py-2 px-2.5">Finger Ext [T,I,M,R,P]</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {!userDataSnapshot?.recentObservations?.length ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-slate-500 font-sans">
                      Collecting background user observations...
                    </td>
                  </tr>
                ) : (
                  userDataSnapshot.recentObservations.slice(0, 15).map((obs: any) => (
                    <tr key={obs.id} className="hover:bg-slate-900/60">
                      <td className="py-1.5 px-2.5 text-slate-400">
                        {new Date(obs.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-200 font-sans">{obs.userName}</td>
                      <td className="py-1.5 px-2.5 text-cyan-400">{obs.source}</td>
                      <td className="py-1.5 px-2.5 text-emerald-300 font-bold">{obs.gesture}</td>
                      <td className="py-1.5 px-2.5 text-purple-300">
                        {Number(obs.tremorHz).toFixed(1)}Hz / {Number(obs.tremorAmplitude).toFixed(3)}
                      </td>
                      <td className="py-1.5 px-2.5 text-sky-300">
                        {Number(obs.palmScale).toFixed(2)} / {Number(obs.fingerSpread).toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-300">
                        {Array.isArray(obs.fingerExtensions)
                          ? obs.fingerExtensions.map((v: number) => Number(v).toFixed(2)).join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Actuation & Rejection Audit Trail */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-cyan-400" />
              Explainable Actuation & Self-Calibration Audit Trail
            </h3>
            <p className="text-xs text-slate-400">
              Every gesture actuation and refusal emits a machine-readable reason code and persists to disk.
            </p>
          </div>

          <div className="flex items-center space-x-2">
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

        {calibrationEvents.length > 0 && (
          <div className="my-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/50 flex items-start gap-2 text-xs">
            <Sparkles className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-cyan-200">
                Active Closed-Loop Self-Calibration:
              </span>
              <p className="text-cyan-300/80 text-[11px] mt-0.5">
                Latest event: {calibrationEvents[0].reason} — Baseline amplitude adjusted from{" "}
                {calibrationEvents[0].previousAmplitude} to {calibrationEvents[0].newAmplitude} RMS.
              </p>
            </div>
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase font-mono">
                <th className="py-2 px-2.5">Time</th>
                <th className="py-2 px-2.5">Target Appliance</th>
                <th className="py-2 px-2.5">User</th>
                <th className="py-2 px-2.5">Command</th>
                <th className="py-2 px-2.5">Decision</th>
                <th className="py-2 px-2.5">Reason Code</th>
                <th className="py-2 px-2.5">Intent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                    No actuation records yet. Show a gesture (e.g., OPEN_PALM for Fan) or click Turn ON/OFF.
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
                      <td className="py-2.5 px-2.5 text-cyan-300 text-[11px]">
                        {log.targetCommand}
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
                        ) : (
                          <span className="text-slate-500 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-2.5 text-slate-200">
                        {(log.intentScore * 100).toFixed(0)}%
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

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
            <p className="text-slate-300 font-sans">
              <strong>Target Command:</strong>{" "}
              <code className="text-cyan-300">{selectedLog.targetCommand}</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
