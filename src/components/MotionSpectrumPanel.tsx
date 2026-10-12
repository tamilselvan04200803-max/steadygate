"use client";

import React, { useEffect, useRef } from "react";
import { SpectrumDataPoint, UserProfile } from "@/lib/types";
import { Activity, Radio, Filter, Zap } from "lucide-react";

interface MotionSpectrumPanelProps {
  user: UserProfile | null;
  spectrumPoints: SpectrumDataPoint[];
  currentF0Hz: number;
  currentAmpRms: number;
  stabilityRaw: number;
  stabilityNorm: number;
  waveformY: number[];
}

export const MotionSpectrumPanel: React.FC<MotionSpectrumPanelProps> = ({
  user,
  spectrumPoints,
  currentF0Hz,
  currentAmpRms,
  stabilityRaw,
  stabilityNorm,
  waveformY,
}) => {
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Draw Waveform Canvas
  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    if (!waveformY || waveformY.length < 2) return;

    // Draw raw trajectory line
    ctx.beginPath();
    ctx.strokeStyle = "#06b6d4";
    ctx.lineWidth = 2;

    const step = width / (waveformY.length - 1);
    const midY = height / 2;
    const scale = height * 4.0; // scale up pixel displacement

    for (let i = 0; i < waveformY.length; i++) {
      const x = i * step;
      const y = midY - waveformY[i] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, [waveformY]);

  // Draw FFT Spectrum Canvas
  useEffect(() => {
    const canvas = spectrumCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Background grid
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    for (let f = 0; f <= 15; f += 2.5) {
      const x = (f / 15) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw Notch Filter Band Region (f0 ± 1.0 Hz)
    const activeF0 = user?.f0Hz || currentF0Hz || 5.2;
    if (activeF0 >= 2.5) {
      const notchStart = Math.max(0, ((activeF0 - 1.0) / 15) * width);
      const notchEnd = Math.min(width, ((activeF0 + 1.0) / 15) * width);
      const notchWidth = notchEnd - notchStart;

      ctx.fillStyle = "rgba(147, 51, 234, 0.18)"; // Violet notch zone
      ctx.fillRect(notchStart, 0, notchWidth, height);

      ctx.strokeStyle = "rgba(168, 85, 247, 0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(notchStart, 0, notchWidth, height);
    }

    if (!spectrumPoints || spectrumPoints.length === 0) return;

    // Draw FFT Spectrum Bars
    const maxFreq = 15;
    const barWidth = Math.max(3, (width / spectrumPoints.length) * 0.85);

    // Find max magnitude for normalization
    let maxMag = 0.001;
    for (const p of spectrumPoints) {
      if (p.freqHz <= maxFreq && p.magnitude > maxMag) {
        maxMag = p.magnitude;
      }
    }

    for (const p of spectrumPoints) {
      if (p.freqHz > maxFreq) continue;

      const x = (p.freqHz / maxFreq) * width;
      const normalizedHeight = Math.min(height - 10, (p.magnitude / maxMag) * (height - 15));
      const y = height - normalizedHeight;

      if (p.isPeak) {
        // Dominant Tremor Peak
        ctx.fillStyle = "#ec4899"; // Pink peak
      } else if (p.inNotchBand) {
        // Inside user's notch band
        ctx.fillStyle = "#a855f7"; // Purple
      } else {
        // Normal harmonic / noise
        ctx.fillStyle = "#38bdf8"; // Cyan
      }

      ctx.fillRect(x - barWidth / 2, y, barWidth, normalizedHeight);
    }

    // Draw Peak Indicator Tag
    if (activeF0 >= 2.5 && activeF0 <= 15) {
      const peakX = (activeF0 / 15) * width;
      ctx.fillStyle = "#ec4899";
      ctx.font = "bold 10px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`f₀ = ${activeF0.toFixed(1)} Hz`, peakX, 12);
    }
  }, [spectrumPoints, user, currentF0Hz]);

  const activeF0 = user?.f0Hz ?? currentF0Hz;
  const activeAmp = user?.amplitudeRms ?? currentAmpRms;

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            Personal Motion Signature (F1 / F2)
          </h3>
        </div>
        <div className="flex items-center space-x-3 text-xs">
          <span className="flex items-center gap-1 text-purple-400 font-mono">
            <Filter className="w-3 h-3 text-purple-400" />
            Notch: [{(activeF0 - 1.0).toFixed(1)} - {(activeF0 + 1.0).toFixed(1)} Hz]
          </span>
          <span className="flex items-center gap-1 text-pink-400 font-mono">
            <Radio className="w-3 h-3 text-pink-400" />
            Peak: {activeF0.toFixed(1)} Hz
          </span>
        </div>
      </div>

      {/* Trajectory Waveform (Top) */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Wrist Landmark Trajectory (Detrended Y-Displacement, 3-sec rolling window)</span>
          <span className="font-mono text-cyan-400">RMS: {activeAmp.toFixed(3)} px/norm</span>
        </div>
        <div className="relative h-14 bg-slate-950 rounded-lg overflow-hidden border border-slate-800/80">
          <canvas
            ref={waveformCanvasRef}
            width={600}
            height={60}
            className="w-full h-full block"
          />
        </div>
      </div>

      {/* FFT Power Spectral Density (Bottom) */}
      <div>
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
          <span>Power Spectral Density (0 - 15 Hz) — Involuntary Motion Frequency Band</span>
          <span className="text-[11px] text-purple-300">Shaded: Notch Attenuation Band</span>
        </div>
        <div className="relative h-28 bg-slate-950 rounded-lg overflow-hidden border border-slate-800/80">
          <canvas
            ref={spectrumCanvasRef}
            width={600}
            height={110}
            className="w-full h-full block"
          />
        </div>
        {/* Frequency Axis Labels */}
        <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1 px-1">
          <span>0 Hz</span>
          <span>2.5 Hz</span>
          <span>5.0 Hz</span>
          <span>7.5 Hz</span>
          <span>10.0 Hz</span>
          <span>12.5 Hz</span>
          <span>15.0 Hz</span>
        </div>
      </div>

      {/* Comparison: Raw Stability vs Signature-Normalized Stability */}
      <div className="mt-4 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-3">
        {/* Raw Jitter / B0 baseline */}
        <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-400">Raw Stability (Prior Art)</span>
            <span
              className={`font-mono font-bold ${
                stabilityRaw < 0.65 ? "text-rose-400" : "text-emerald-400"
              }`}
            >
              {(stabilityRaw * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${
                stabilityRaw < 0.65 ? "bg-rose-500" : "bg-emerald-500"
              }`}
              style={{ width: `${Math.min(100, Math.max(0, stabilityRaw * 100))}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {stabilityRaw < 0.65
              ? "❌ Fails fixed threshold; shakes rejected as accidental"
              : "✓ Hand is still"}
          </p>
        </div>

        {/* Signature-Normalized Stability (SteadyGate F2) */}
        <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-800/40">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-cyan-300 font-medium flex items-center gap-1">
              <Zap className="w-3 h-3 text-cyan-400" />
              S_norm (SteadyGate F2)
            </span>
            <span
              className={`font-mono font-bold ${
                stabilityNorm >= 0.70 ? "text-cyan-300" : "text-amber-400"
              }`}
            >
              {(stabilityNorm * 100).toFixed(0)}%
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-150"
              style={{ width: `${Math.min(100, Math.max(0, stabilityNorm * 100))}%` }}
            />
          </div>
          <p className="text-[10px] text-cyan-400/90 mt-1">
            {stabilityNorm >= 0.70
              ? "✓ Post-notch residual is still. Intent recognized!"
              : "⚠️ Motion exceeds profile"}
          </p>
        </div>
      </div>
    </div>
  );
};
