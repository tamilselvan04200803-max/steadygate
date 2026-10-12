"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Shield,
  Eye,
  Activity,
  Brain,
  Radio,
  ShieldAlert,
  Wand2,
  HeartPulse,
  RefreshCw,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Cpu,
  Terminal,
  Lock,
  Zap,
  FileWarning,
  Layers,
} from "lucide-react";

interface RosterAgent {
  id: string;
  name: string;
  role: string;
  scope: string;
  model: {
    id: string;
    name: string;
    family: string;
    specialty: string;
    version: string;
    trainingScope: string[];
    confidenceFloor: number;
  };
  color: string;
  icon: string;
  description: string;
}

interface Finding {
  id: string;
  agentId: string;
  agentName: string;
  modelId: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  title: string;
  symptom: string;
  rootCause: string;
  evidence: string;
  fixSteps: string;
  codeHints: string;
  affectedModules: string;
  confidence: number;
  status: string;
  runId: string;
  createdAt: string;
}

interface AgentRun {
  id: string;
  trigger: string;
  status: string;
  agentsInvoked: number;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  summary: string;
  durationMs: number;
  createdAt: string;
  completedAt?: string | null;
}

interface TraceStep {
  agentId: string;
  agentName: string;
  modelId: string;
  phase: string;
  message: string;
  ts: string;
  durationMs: number;
}

const iconMap: Record<string, React.ReactNode> = {
  Eye: <Eye className="w-4 h-4" />,
  Activity: <Activity className="w-4 h-4" />,
  Brain: <Brain className="w-4 h-4" />,
  Radio: <Radio className="w-4 h-4" />,
  ShieldAlert: <ShieldAlert className="w-4 h-4" />,
  Wand2: <Wand2 className="w-4 h-4" />,
  HeartPulse: <HeartPulse className="w-4 h-4" />,
  Bot: <Bot className="w-4 h-4" />,
};

function severityStyle(sev: string) {
  switch (sev) {
    case "CRITICAL":
      return "bg-rose-600 text-white border-rose-400";
    case "HIGH":
      return "bg-orange-600/90 text-white border-orange-400";
    case "MEDIUM":
      return "bg-amber-600/80 text-white border-amber-400";
    case "LOW":
      return "bg-slate-600 text-slate-100 border-slate-400";
    default:
      return "bg-cyan-800 text-cyan-100 border-cyan-500";
  }
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function parseEvidence(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export const AdminAgentConsole: React.FC = () => {
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [traces, setTraces] = useState<TraceStep[]>([]);
  const [stats, setStats] = useState({
    openTotal: 0,
    criticalOpen: 0,
    highOpen: 0,
    agentsOnline: 0,
  });
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [filterSev, setFilterSev] = useState<string>("ALL");
  const [filterAgent, setFilterAgent] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<string>("OPEN");
  const [lastSummary, setLastSummary] = useState<string>("");
  const [remediation, setRemediation] = useState<string[]>([]);
  const [probes, setProbes] = useState<Array<{ route: string; status: number; ok: boolean; latencyMs: number; error?: string }>>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<Record<string, unknown> | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({});
  const [killSwitchMsg, setKillSwitchMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/agents?limit=100");
      const data = await res.json();
      if (data.success) {
        setRoster(data.roster || []);
        setFindings(data.findings || []);
        setRuns(data.runs || []);
        setStats(data.stats || stats);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const runCouncil = useCallback(async (trigger = "MANUAL") => {
    setScanning(true);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger }),
      });
      const data = await res.json();
      if (data.success) {
        setTraces(data.traces || []);
        setLastSummary(data.summary || "");
        setRemediation(data.remediation || []);
        setProbes(data.probes || []);
        setSnapshotMeta(data.snapshotMeta || null);
        await load();
        if (data.findings?.length) {
          const top = data.findings.find(
            (f: Finding) => f.severity === "CRITICAL" || f.severity === "HIGH"
          );
          if (top) setSelectedFinding(top);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setScanning(false);
    }
  }, [load]);

  useEffect(() => {
    load().then(() => runCouncil("BOOT"));
  }, []);

  // Continuous agent loop (admin mode)
  useEffect(() => {
    if (!autoScan) return;
    const id = setInterval(() => {
      runCouncil("CONTINUOUS");
    }, 28000);
    return () => clearInterval(id);
  }, [autoScan, runCouncil]);

  const updateFindingStatus = async (findingId: string, status: string) => {
    try {
      await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, status }),
      });
      await load();
      if (selectedFinding?.id === findingId) {
        setSelectedFinding((prev) => (prev ? { ...prev, status } : null));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const emergencyKillR2 = async () => {
    setKillSwitchMsg("Killing R2 hazards…");
    try {
      const listRes = await fetch("/api/appliances");
      const listData = await listRes.json();
      const r2 = (listData.appliances || []).filter(
        (a: { riskTier: string; id: string }) => a.riskTier === "R2"
      );
      for (const a of r2) {
        // Deadbolt ON = locked; others OFF
        const powerState = String(a.id).includes("deadbolt") ? "ON" : "OFF";
        await fetch("/api/appliances", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: a.id,
            powerState,
            adminOverride: true,
            reason: "Admin emergency kill switch — HazardSentinel",
          }),
        });
      }
      setKillSwitchMsg("✓ R2 devices secured (heater/geyser OFF, deadbolt LOCKED)");
      await runCouncil("EVENT");
    } catch {
      setKillSwitchMsg("Kill switch failed");
    }
    setTimeout(() => setKillSwitchMsg(null), 5000);
  };

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (filterSev !== "ALL" && f.severity !== filterSev) return false;
      if (filterAgent !== "ALL" && f.agentId !== filterAgent) return false;
      if (filterStatus !== "ALL" && f.status !== filterStatus) return false;
      return true;
    });
  }, [findings, filterSev, filterAgent, filterStatus]);

  const openCritical = findings.filter((f) => f.status === "OPEN" && f.severity === "CRITICAL");
  const openHigh = findings.filter((f) => f.status === "OPEN" && f.severity === "HIGH");

  return (
    <div className="space-y-5">
      {/* Admin banner */}
      <div className="rounded-2xl border border-amber-700/60 bg-gradient-to-r from-amber-950/80 via-slate-900 to-rose-950/50 p-4 shadow-xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/50 flex items-center justify-center">
              <Shield className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Admin Mode — Multi-Agent Debug Council</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-600 text-white font-bold animate-pulse">
                  LIVE AGENTS
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 max-w-2xl">
                Twelve scope-specialized brains: browser runtime (MediaPipe load, fps, JS errors), scene
                robustness, intent continuity, live API probes, vision, tremor DSP, intent gating, IoT
                physics, R2 safety, personalization, system health — ChiefDebugger correlates root causes.
                Agents auto-fix what they safely can and auto-resolve findings whose cause has cleared.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => runCouncil("MANUAL")}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md disabled:opacity-60"
            >
              {scanning ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {scanning ? "Council Running…" : "Run Full Council Scan"}
            </button>
            <button
              onClick={() => setAutoScan((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border ${
                autoScan
                  ? "bg-emerald-950 border-emerald-600 text-emerald-300"
                  : "bg-slate-900 border-slate-700 text-slate-400"
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              Continuous {autoScan ? "ON (28s)" : "OFF"}
            </button>
            <button
              onClick={emergencyKillR2}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 text-white text-xs font-bold border border-rose-400/40"
            >
              <Zap className="w-3.5 h-3.5" />
              R2 Kill Switch
            </button>
          </div>
        </div>

        {killSwitchMsg && (
          <div className="mt-3 text-xs text-amber-200 bg-black/30 rounded-lg px-3 py-2 border border-amber-800">
            {killSwitchMsg}
          </div>
        )}

        {lastSummary && (
          <div className="mt-3 text-xs font-mono text-slate-200 bg-black/40 rounded-lg px-3 py-2 border border-slate-700">
            <span className="text-slate-500">Last council: </span>
            {lastSummary}
            {snapshotMeta && (
              <span className="text-slate-500">
                {" "}· browser telemetry samples: {String(snapshotMeta.telemetrySamples ?? 0)}
              </span>
            )}
          </div>
        )}

        {remediation.length > 0 && (
          <div className="mt-2 text-xs bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-3 py-2">
            <div className="text-emerald-300 font-bold mb-1 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Agents auto-debugged {remediation.length} issue(s) this run
            </div>
            <ul className="space-y-0.5 text-emerald-100/90 font-mono text-[11px]">
              {remediation.map((r) => (
                <li key={r}>↳ {r}</li>
              ))}
            </ul>
          </div>
        )}

        {probes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {probes.map((p) => (
              <span
                key={p.route}
                title={p.error || ""}
                className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                  p.ok ? "bg-emerald-950/50 border-emerald-800 text-emerald-300" : "bg-rose-950/60 border-rose-700 text-rose-300"
                }`}
              >
                {p.route.replace("/api/", "").replace("#", " ")} · {p.status || "ERR"} · {p.latencyMs}ms
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] text-slate-400 uppercase">Agents Online</div>
          <div className="text-2xl font-black text-cyan-400 font-mono">{roster.length || stats.agentsOnline}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] text-slate-400 uppercase">Open Findings</div>
          <div className="text-2xl font-black text-white font-mono">{stats.openTotal}</div>
        </div>
        <div className="bg-rose-950/40 border border-rose-800 rounded-xl p-3">
          <div className="text-[10px] text-rose-300 uppercase">Critical Open</div>
          <div className="text-2xl font-black text-rose-400 font-mono">{openCritical.length}</div>
        </div>
        <div className="bg-orange-950/30 border border-orange-800 rounded-xl p-3">
          <div className="text-[10px] text-orange-300 uppercase">High Open</div>
          <div className="text-2xl font-black text-orange-400 font-mono">{openHigh.length}</div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className="text-[10px] text-slate-400 uppercase">Last Run</div>
          <div className="text-sm font-bold text-slate-200 font-mono mt-1">
            {runs[0] ? `${runs[0].durationMs}ms · ${runs[0].findingsCount} hits` : "—"}
          </div>
        </div>
      </div>

      {/* Agent roster cards */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            Agent Roster & Scope-Trained Models
          </h3>
          <span className="text-[10px] text-slate-500 font-mono">Each brain = domain expert model</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {roster.map((a) => {
            const agentFindings = findings.filter(
              (f) => f.agentId === a.id && f.status === "OPEN"
            );
            const expanded = expandedAgents[a.id];
            return (
              <div
                key={a.id}
                className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 hover:border-slate-600 transition-colors"
                style={{ borderTopColor: a.color, borderTopWidth: 2 }}
              >
                <button
                  className="w-full text-left"
                  onClick={() =>
                    setExpandedAgents((prev) => ({ ...prev, [a.id]: !prev[a.id] }))
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="p-1.5 rounded-lg"
                        style={{ backgroundColor: `${a.color}22`, color: a.color }}
                      >
                        {iconMap[a.icon] || <Bot className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white">{a.name}</div>
                        <div className="text-[10px] text-slate-400 line-clamp-1">{a.role}</div>
                      </div>
                    </div>
                    {expanded ? (
                      <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                    )}
                  </div>
                </button>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="font-mono text-slate-500">{a.model.id}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold ${
                      agentFindings.length
                        ? "bg-rose-950 text-rose-300"
                        : "bg-emerald-950 text-emerald-400"
                    }`}
                  >
                    {agentFindings.length} open
                  </span>
                </div>
                {expanded && (
                  <div className="mt-2 pt-2 border-t border-slate-800 space-y-1.5 text-[10px] text-slate-400">
                    <p className="text-slate-300">{a.description}</p>
                    <p>
                      <span className="text-slate-500">Model: </span>
                      <span className="text-cyan-300">{a.model.name}</span> v{a.model.version}
                    </p>
                    <p>
                      <span className="text-slate-500">Family: </span>
                      {a.model.family}
                    </p>
                    <p className="text-slate-500">Trained on:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                      {a.model.trainingScope.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">
        {/* Findings list */}
        <div className="xl:col-span-2 bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-amber-400" />
              Findings Feed
            </h3>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <select
                aria-label="Filter severity"
                value={filterSev}
                onChange={(e) => setFilterSev(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-slate-300"
              >
                {["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter agent"
                value={filterAgent}
                onChange={(e) => setFilterAgent(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-slate-300"
              >
                <option value="ALL">All agents</option>
                {roster.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-slate-300"
              >
                {["ALL", "OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
            {loading && filtered.length === 0 && (
              <div className="text-xs text-slate-500 py-8 text-center">Loading findings…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="text-xs text-slate-500 py-8 text-center">
                No findings for this filter. Run council scan.
              </div>
            )}
            {filtered.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFinding(f)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedFinding?.id === f.id
                    ? "border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/30"
                    : "border-slate-800 bg-slate-950/50 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${severityStyle(
                      f.severity
                    )}`}
                  >
                    {f.severity}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{f.agentName}</span>
                  <span className="text-[9px] text-slate-600 ml-auto">{f.status}</span>
                </div>
                <div className="text-xs font-semibold text-slate-100 line-clamp-2">{f.title}</div>
                <div className="text-[10px] text-slate-500 mt-1 font-mono">
                  {f.category} · conf {(f.confidence * 100).toFixed(0)}%
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Finding detail + fix package */}
        <div className="xl:col-span-3 bg-slate-900/80 border border-slate-800 rounded-xl p-4 min-h-[640px]">
          {!selectedFinding ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm gap-2">
              <Layers className="w-10 h-10 text-slate-700" />
              Select a finding to view root cause, evidence, and exact debugging solution.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded border ${severityStyle(
                        selectedFinding.severity
                      )}`}
                    >
                      {selectedFinding.severity}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                      {selectedFinding.category}
                    </span>
                    <span className="text-[10px] text-cyan-400 font-mono">
                      {selectedFinding.modelId}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-white leading-snug">
                    {selectedFinding.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Agent <strong className="text-slate-200">{selectedFinding.agentName}</strong> ·
                    confidence {(selectedFinding.confidence * 100).toFixed(0)}% ·{" "}
                    {new Date(selectedFinding.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  {["ACKNOWLEDGED", "RESOLVED", "IGNORED", "OPEN"].map((s) => (
                    <button
                      key={s}
                      onClick={() => updateFindingStatus(selectedFinding.id, s)}
                      className={`text-[10px] px-2 py-1 rounded border font-semibold ${
                        selectedFinding.status === s
                          ? "bg-cyan-700 border-cyan-500 text-white"
                          : "bg-slate-950 border-slate-700 text-slate-400 hover:text-white"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] uppercase text-amber-400 font-bold mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Symptom
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedFinding.symptom}</p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-rose-900/50">
                  <div className="text-[10px] uppercase text-rose-400 font-bold mb-1 flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Root Cause
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedFinding.rootCause}</p>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] uppercase text-cyan-400 font-bold mb-2 flex items-center gap-1">
                  <Terminal className="w-3 h-3" /> Evidence (machine snapshot)
                </div>
                <pre className="text-[10px] font-mono text-slate-400 overflow-x-auto max-h-40">
                  {JSON.stringify(parseEvidence(selectedFinding.evidence), null, 2)}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/50">
                <div className="text-[10px] uppercase text-emerald-400 font-bold mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Exact Debugging Solution (ordered)
                </div>
                <ol className="space-y-2">
                  {parseJsonArray(selectedFinding.fixSteps).map((step, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-200">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-700 text-white text-[10px] font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] uppercase text-indigo-400 font-bold mb-2">
                    Code Hints
                  </div>
                  <ul className="space-y-1">
                    {parseJsonArray(selectedFinding.codeHints).map((h) => (
                      <li key={h} className="text-[11px] font-mono text-indigo-200 bg-indigo-950/30 px-2 py-1 rounded">
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <div className="text-[10px] uppercase text-purple-400 font-bold mb-2">
                    Affected Modules
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {parseJsonArray(selectedFinding.affectedModules).map((m) => (
                      <span
                        key={m}
                        className="text-[10px] px-2 py-1 rounded-full bg-purple-950 text-purple-300 border border-purple-800"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Traces + Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            Live Agent Reasoning Traces
          </h3>
          <div className="space-y-1.5 max-h-64 overflow-y-auto font-mono text-[10px]">
            {traces.length === 0 && (
              <p className="text-slate-500">Run a council scan to stream OBSERVE → REASON → DIAGNOSE → PRESCRIBE traces.</p>
            )}
            {traces.map((t, i) => (
              <div
                key={`${t.agentId}-${i}`}
                className="flex gap-2 p-1.5 rounded bg-slate-950/80 border border-slate-800/80"
              >
                <span className="text-slate-600 w-14 flex-shrink-0">{t.phase}</span>
                <span className="text-cyan-500 w-24 flex-shrink-0 truncate">{t.agentName}</span>
                <span className="text-slate-300 flex-1">{t.message}</span>
                <span className="text-slate-600">{t.durationMs}ms</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-slate-400" />
            Council Run History
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {runs.map((r) => (
              <div
                key={r.id}
                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-slate-400 text-[10px]">{r.id}</span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      r.criticalCount > 0
                        ? "bg-rose-950 text-rose-300"
                        : r.highCount > 0
                        ? "bg-orange-950 text-orange-300"
                        : "bg-emerald-950 text-emerald-300"
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <p className="text-slate-300 mt-1 text-[11px]">{r.summary}</p>
                <div className="flex gap-3 mt-1 text-[10px] text-slate-500 font-mono">
                  <span>{r.trigger}</span>
                  <span>{r.agentsInvoked} agents</span>
                  <span>{r.findingsCount} findings</span>
                  <span>{r.durationMs}ms</span>
                  <span>{new Date(r.createdAt).toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-[10px] text-slate-600 text-center flex items-center justify-center gap-2">
        <Lock className="w-3 h-3" />
        Admin-only surface — end users in User Mode never see agent findings, traces, or kill controls.
      </div>
    </div>
  );
};
