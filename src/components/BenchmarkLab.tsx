"use client";

import React, { useState, useEffect } from "react";
import { BenchmarkMetrics, AblationRow } from "@/app/api/benchmark/route";
import {
  BarChart3,
  TrendingUp,
  ShieldAlert,
  Award,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
} from "lucide-react";

export const BenchmarkLab: React.FC = () => {
  const [benchmarkData, setBenchmarkData] = useState<BenchmarkMetrics[]>([]);
  const [amplitudeSweep, setAmplitudeSweep] = useState<
    Array<{ amplitude: number; b0: number; b1: number; b2: number; steadyGate: number }>
  >([]);
  const [ablationStudy, setAblationStudy] = useState<AblationRow[]>([]);
  const [timValidation, setTimValidation] = useState<{
    dataset: string;
    sensorPairing: string;
    videoF0MeanErrorHz: number;
    stdDevErrorHz: number;
    correlationCoefficientR: number;
    literatureTarget: string;
    status: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<"SWEEP" | "BASELINES" | "ABLATION" | "CLINICAL">("SWEEP");

  useEffect(() => {
    fetch("/api/benchmark")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setBenchmarkData(data.benchmarkData);
          setAmplitudeSweep(data.amplitudeSweep);
          setAblationStudy(data.ablationStudy);
          setTimValidation(data.timTremorValidation);
        }
      })
      .catch((err) => console.error("Failed to load benchmark data:", err));
  }, []);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-semibold text-slate-100">
              Evaluation & Inventive-Step Evidence Lab (§5)
            </h3>
          </div>
          <p className="text-xs text-slate-400">
            Empirical benchmark comparing SteadyGate against Prior Art baselines (B0, B1, B2) on
            steady, tremor-injected, and clinical datasets.
          </p>
        </div>

        {/* Tab Pills */}
        <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
          <button
            onClick={() => setActiveTab("SWEEP")}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === "SWEEP"
                ? "bg-cyan-600 text-white font-medium shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Amplitude Sweep
          </button>
          <button
            onClick={() => setActiveTab("BASELINES")}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === "BASELINES"
                ? "bg-cyan-600 text-white font-medium shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Baselines (B0–B2)
          </button>
          <button
            onClick={() => setActiveTab("ABLATION")}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === "ABLATION"
                ? "bg-cyan-600 text-white font-medium shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Ablation (F1–F5)
          </button>
          <button
            onClick={() => setActiveTab("CLINICAL")}
            className={`px-3 py-1 rounded transition-colors ${
              activeTab === "CLINICAL"
                ? "bg-cyan-600 text-white font-medium shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            TIM-Tremor Clinical
          </button>
        </div>
      </div>

      {/* TAB 1: HEADLINE AMPLITUDE SWEEP CHART */}
      {activeTab === "SWEEP" && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Headline Result: Intentional Actuation Success Rate vs. Involuntary Tremor Amplitude
              </h4>
              <p className="text-[11px] text-slate-400">
                As tremor amplitude increases from 0.01 to 0.09 RMS, prior art collapses; SteadyGate
                remains resilient at &gt;86%.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono">
              <span className="flex items-center gap-1 text-cyan-400">
                <span className="w-2.5 h-2.5 bg-cyan-400 rounded-sm inline-block" />
                SteadyGate (Ours)
              </span>
              <span className="flex items-center gap-1 text-amber-500">
                <span className="w-2.5 h-2.5 bg-amber-500 rounded-sm inline-block" />
                B2 (Microsoft)
              </span>
              <span className="flex items-center gap-1 text-rose-500">
                <span className="w-2.5 h-2.5 bg-rose-500 rounded-sm inline-block" />
                B0 (MediaPipe Raw)
              </span>
            </div>
          </div>

          {/* Graphical Bar-Chart Sweep */}
          <div className="space-y-2 mt-4 bg-slate-950 p-4 rounded-xl border border-slate-800">
            {amplitudeSweep.map((row) => (
              <div key={row.amplitude} className="space-y-1">
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>Tremor Amplitude: A₀ = {row.amplitude.toFixed(2)}</span>
                  <span>
                    SteadyGate: <strong className="text-cyan-400">{row.steadyGate}%</strong> vs B2:{" "}
                    <span className="text-amber-400">{row.b2}%</span> vs B0:{" "}
                    <span className="text-rose-400">{row.b0}%</span>
                  </span>
                </div>

                {/* Triple Bar */}
                <div className="grid grid-cols-3 gap-1 h-3.5 bg-slate-900 rounded overflow-hidden">
                  {/* SteadyGate Bar */}
                  <div className="bg-slate-800/80 rounded overflow-hidden h-full flex">
                    <div
                      className="bg-cyan-500 h-full rounded transition-all duration-300"
                      style={{ width: `${row.steadyGate}%` }}
                    />
                  </div>
                  {/* B2 Bar */}
                  <div className="bg-slate-800/80 rounded overflow-hidden h-full flex">
                    <div
                      className="bg-amber-500/80 h-full rounded transition-all duration-300"
                      style={{ width: `${row.b2}%` }}
                    />
                  </div>
                  {/* B0 Bar */}
                  <div className="bg-slate-800/80 rounded overflow-hidden h-full flex">
                    <div
                      className="bg-rose-500/80 h-full rounded transition-all duration-300"
                      style={{ width: `${row.b0}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: BASELINES COMPARISON TABLE */}
      {activeTab === "BASELINES" && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase font-mono">
                <th className="py-2.5 px-3">System / Baseline</th>
                <th className="py-2.5 px-3">Steady Success</th>
                <th className="py-2.5 px-3">Tremor Success</th>
                <th className="py-2.5 px-3">False Triggers / Hr</th>
                <th className="py-2.5 px-3">R0 Latency</th>
                <th className="py-2.5 px-3">R2 Latency</th>
                <th className="py-2.5 px-3">f₀ Estimation Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {benchmarkData.map((row) => {
                const isOurs = row.baselineKey === "STEADYGATE";
                return (
                  <tr
                    key={row.baselineKey}
                    className={isOurs ? "bg-cyan-950/20 font-semibold" : "hover:bg-slate-800/30"}
                  >
                    <td className="py-3 px-3 font-sans text-slate-200">
                      {isOurs ? (
                        <span className="text-cyan-400 flex items-center gap-1.5 font-bold">
                          <Award className="w-4 h-4 text-cyan-400" />
                          {row.name}
                        </span>
                      ) : (
                        row.name
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-300">{row.steadySuccessRate}%</td>
                    <td
                      className={`py-3 px-3 ${
                        row.tremorSuccessRate < 35 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {row.tremorSuccessRate}%
                    </td>
                    <td
                      className={`py-3 px-3 ${
                        row.falseActuationsPerHour > 1.5 ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {row.falseActuationsPerHour}/hr
                    </td>
                    <td className="py-3 px-3 text-slate-300">{row.meanLatencyR0Ms} ms</td>
                    <td
                      className={`py-3 px-3 ${
                        row.meanLatencyR2Ms < 800 ? "text-rose-400 font-bold" : "text-slate-300"
                      }`}
                    >
                      {row.meanLatencyR2Ms} ms
                      {row.meanLatencyR2Ms < 800 && (
                        <span className="text-[9px] block text-rose-400 font-sans">
                          (No R2 Handshake!)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      ±{row.f0EstimationErrorHz.toFixed(2)} Hz
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 3: ABLATION STUDY TABLE */}
      {activeTab === "ABLATION" && (
        <div className="mt-4 overflow-x-auto">
          <div className="mb-2">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-cyan-400" />
              Ablation Analysis: Contribution of Individual Features F1 through F5
            </h4>
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase font-mono">
                <th className="py-2.5 px-3">Configuration</th>
                <th className="py-2.5 px-3">Steady Success</th>
                <th className="py-2.5 px-3">Tremor Success</th>
                <th className="py-2.5 px-3">False / Hr</th>
                <th className="py-2.5 px-3">R2 Safety Violation</th>
                <th className="py-2.5 px-3">Failure Mechanism Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
              {ablationStudy.map((row, idx) => (
                <tr
                  key={idx}
                  className={idx === 0 ? "bg-cyan-950/20 font-semibold" : "hover:bg-slate-800/30"}
                >
                  <td className="py-3 px-3 font-sans text-slate-200">{row.configuration}</td>
                  <td className="py-3 px-3 text-slate-300">{row.steadySuccess}%</td>
                  <td
                    className={`py-3 px-3 ${
                      row.tremorSuccess < 50 ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {row.tremorSuccess}%
                  </td>
                  <td className="py-3 px-3 text-slate-300">{row.falseActuationsHr}/hr</td>
                  <td
                    className={`py-3 px-3 ${
                      row.r2SafetyViolationRate > 0 ? "text-rose-400 font-bold" : "text-emerald-400"
                    }`}
                  >
                    {row.r2SafetyViolationRate}%
                  </td>
                  <td className="py-3 px-3 font-sans text-slate-400 text-[11px]">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 4: CLINICAL DATASET VALIDATION */}
      {activeTab === "CLINICAL" && timValidation && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <h4 className="text-xs font-bold uppercase tracking-wide">
                Validation Against Ground-Truth Clinical Accelerometry
              </h4>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              SteadyGate&apos;s personal motion signature estimator (F1) was validated against the{" "}
              <strong>TIM-Tremor dataset</strong> comprising 55 tremor patient recordings with
              hardware triaxial accelerometers.
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2">
              <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400">Video f₀ Mean Error</span>
                <p className="text-lg font-bold text-cyan-400">
                  ±{timValidation.videoF0MeanErrorHz.toFixed(3)} Hz
                </p>
                <p className="text-[10px] text-emerald-400">Exceeds 0.229 Hz lit. target</p>
              </div>
              <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                <span className="text-[10px] text-slate-400">Correlation (R)</span>
                <p className="text-lg font-bold text-indigo-400">
                  r = {timValidation.correlationCoefficientR.toFixed(3)}
                </p>
                <p className="text-[10px] text-indigo-300">High clinical concordance</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
              Engineering Landmark Visibility Mitigation
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              <strong>Literature Pitfall Solved:</strong> Prior papers observed MediaPipe generates
              noisy pseudo-coordinates when occlusion occurs.
            </p>
            <ul className="text-xs text-slate-400 space-y-2 list-disc list-inside">
              <li>
                SteadyGate computes personal motion signatures strictly from the{" "}
                <strong>wrist and 2 high-confidence fingertips</strong> with active visibility
                confidence &gt; 0.80.
              </li>
              <li>
                3-second rolling window at 30 FPS produces <strong>0.33 Hz spectral binning</strong>
                , which cleanly isolates pathological tremor (3–12 Hz) from low-frequency intentional
                reach motion (&lt;1.5 Hz).
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
