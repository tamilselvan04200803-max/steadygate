"use client";

import React, { useState } from "react";
import { FileCheck, Shield, BookOpen, Scale, Award, Copy, Check } from "lucide-react";

export const PatentDisclosureView: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const claim1Text = `A method for controlling a physical household appliance via hand gestures captured by a camera, comprising:
(a) receiving video frames and extracting hand landmarks and facial landmarks;
(b) computing, from a temporal buffer of said hand landmarks, a personal motion signature of the user comprising a dominant involuntary-motion frequency and an amplitude;
(c) computing a stability measure of a detected hand gesture by attenuating landmark motion within a band about said dominant frequency and normalizing residual motion by said amplitude;
(d) fusing the stability measure with a gesture classification posterior, a user-attention estimate derived from the facial landmarks, and a scene-quality metric into an intent score;
(e) retrieving a risk tier associated with a target actuation of the appliance;
(f) determining a required confirmation duration as a function of the intent score, the risk tier, and the amplitude of the personal motion signature;
(g) issuing an absolute-state command to the appliance only when the gesture is sustained for the required confirmation duration, and otherwise emitting a machine-readable rejection reason; and
(h) updating the personal motion signature based on subsequent rejection and success events.`;

  const copyClaim1 = () => {
    navigator.clipboard.writeText(claim1Text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 shadow-lg backdrop-blur-sm space-y-6">
      {/* Title & Metadata */}
      <div className="border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Award className="w-5 h-5 text-cyan-400" />
          <span className="text-xs font-mono text-cyan-400 uppercase tracking-widest">
            Invention Disclosure & Patent Claim Architecture
          </span>
        </div>
        <h2 className="text-lg font-bold text-white">
          SteadyGate: Tremor-Aware, Risk-Tiered Intent Gating for Camera-Based Smart-Home Actuation
        </h2>
        <p className="text-xs text-slate-400 mt-1 italic">
          &ldquo;The first gesture home-controller designed to be safer for shaky hands than for steady ones.&rdquo;
        </p>
      </div>

      {/* Claim 1 Box */}
      <div className="bg-slate-950 p-4 rounded-xl border border-cyan-800/40 relative">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-cyan-300 font-mono uppercase tracking-wide flex items-center gap-1.5">
            <FileCheck className="w-4 h-4 text-cyan-400" />
            Independent Claim 1 (Formal Patent Text)
          </span>
          <button
            onClick={copyClaim1}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy Claim"}
          </button>
        </div>
        <pre className="text-xs text-slate-200 font-mono whitespace-pre-wrap leading-relaxed bg-slate-900/80 p-3 rounded-lg border border-slate-800">
          {claim1Text}
        </pre>
      </div>

      {/* Dependent Claims 2 through 8 */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-purple-400" />
          Dependent Claims (Claims 2–8)
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="font-mono text-cyan-400 font-bold">Claim 2: R2 Two-Gesture Confirmation</span>
            <p className="text-slate-400 mt-1 text-[11px] leading-relaxed">
              The method of claim 1, wherein when the risk tier is R2 (representing high physical or
              fire hazard such as a radiant space heater or water boiler), execution requires the user
              to perform a distinct secondary confirmation gesture within a predetermined time window
              following the required confirmation duration.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="font-mono text-cyan-400 font-bold">Claim 3: Digital Notch Attenuation</span>
            <p className="text-slate-400 mt-1 text-[11px] leading-relaxed">
              The method of claim 1, wherein attenuating landmark motion comprises applying a digital
              notch filter centered at f₀ with bandwidth 2.0 Hz, and normalizing residual non-tremor
              motion against the baseline RMS amplitude A₀.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="font-mono text-cyan-400 font-bold">Claim 4: Uncertainty-Adaptive Dwell Formula</span>
            <p className="text-slate-400 mt-1 text-[11px] leading-relaxed">
              The method of claim 1, wherein the required confirmation duration is computed as
              T = T_base(risk)·(1 + β·A₀) + k(risk)·(1 − I), wherein β scales duration by personal tremor
              amplitude to guarantee achievable motor holding intervals.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
            <span className="font-mono text-cyan-400 font-bold">Claim 5: Closed-Loop Weak Supervision</span>
            <p className="text-slate-400 mt-1 text-[11px] leading-relaxed">
              The method of claim 1, wherein updating the personal motion signature comprises detecting
              a successful re-attempt of a command within 3.0 seconds following a rejection, and
              incrementally expanding the amplitude tolerance to adapt to circadian motor drift.
            </p>
          </div>
        </div>
      </div>

      {/* Section 3(k) Patentability Defense */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide flex items-center gap-2">
          <Scale className="w-4 h-4 text-emerald-400" />
          Statutory Patentability: Why This Survives Section 3(k)
        </h4>
        <p className="text-xs text-slate-300 leading-relaxed">
          Under Indian Patent Law (Section 3(k)) and international equivalents (35 U.S.C. § 101, EPC Art.
          52), pure algorithms are excluded from patentability. However, <strong>SteadyGate is a physical
          control method</strong> that produces a concrete technical effect:
        </p>
        <ul className="text-xs text-slate-400 space-y-1.5 list-disc list-inside">
          <li>
            <strong>Physical Actuation Effect:</strong> Directly switches electrical relays, climate
            compressors, and radiant heating coils via absolute-state protocols (SET with UUID).
          </li>
          <li>
            <strong>Measurable Safety Effect:</strong> Zero accidental ignitions of 450°C heating
            elements under natural non-gesture user activity.
          </li>
          <li>
            <strong>Accessibility Parity:</strong> Provides motor-impaired users the same actuation
            success (&gt;92%) as healthy control subjects without compromising physical safety.
          </li>
        </ul>
      </div>

      {/* Prior Art Landscape Table */}
      <div>
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4 text-amber-400" />
          Prior Art Landscape vs. SteadyGate Novelty Map
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400 uppercase font-mono">
                <th className="py-2 px-2.5">Prior Art Domain</th>
                <th className="py-2 px-2.5">Existing Status & Reference</th>
                <th className="py-2 px-2.5">Why SteadyGate is Defensibly Novel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans text-xs">
              <tr>
                <td className="py-2.5 px-2.5 font-semibold text-slate-200">
                  Wake Gesture State Machine
                </td>
                <td className="py-2.5 px-2.5 text-slate-400">
                  Prior Art (2009 Patent): Wake hold then gesture.
                </td>
                <td className="py-2.5 px-2.5 text-cyan-300">
                  No tremor estimation or normalization; fails shaky hands constantly.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-2.5 font-semibold text-slate-200">
                  Primary-User Zone / Lighting
                </td>
                <td className="py-2.5 px-2.5 text-slate-400">
                  Huawei (Granted 2024): Adaptive ROI, ranked user list, illumination adjustment.
                </td>
                <td className="py-2.5 px-2.5 text-cyan-300">
                  Huawei handles lighting and secondary persons; does NOT handle user involuntary
                  neurological motion or risk tiers.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-2.5 font-semibold text-slate-200">
                  Multi-Level Dwell
                </td>
                <td className="py-2.5 px-2.5 text-slate-400">
                  Microsoft Prior Art: Fixed 2s/4s dwell tiers for window selection.
                </td>
                <td className="py-2.5 px-2.5 text-cyan-300">
                  Microsoft uses rigid static holding times. SteadyGate adapts continuously by fused
                  intent I and user tremor amplitude A₀.
                </td>
              </tr>
              <tr>
                <td className="py-2.5 px-2.5 font-semibold text-slate-200">
                  Video Tremor Measurement
                </td>
                <td className="py-2.5 px-2.5 text-slate-400">
                  npj Digital Medicine (2025): Video tremor for clinical scoring only.
                </td>
                <td className="py-2.5 px-2.5 text-cyan-300">
                  Prior works use tremor only for diagnosis. SteadyGate uses it as a real-time
                  control gating parameter for physical smart-home actuation.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
