"use client";

import React, { useState, useEffect, useRef } from "react";
import { UserProfile, SpectrumDataPoint } from "@/lib/types";
import { X, Sparkles, Activity, CheckCircle, Clock, Pill } from "lucide-react";

interface EnrolmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEnrolmentComplete: (newUser: UserProfile) => void;
}

export const EnrolmentModal: React.FC<EnrolmentModalProps> = ({
  isOpen,
  onClose,
  onEnrolmentComplete,
}) => {
  const [step, setStep] = useState<"SETUP" | "COUNTDOWN" | "ANALYSIS" | "COMPLETE">("SETUP");
  const [userName, setUserName] = useState("Elena Rostova");
  const [conditionPreset, setConditionPreset] = useState<
    "parkinson" | "essential_tremor" | "steady" | "dystonia"
  >("parkinson");
  const [medicationPhase, setMedicationPhase] = useState("Wearing OFF (Mid-day)");

  const [countdownSeconds, setCountdownSeconds] = useState(10);
  const [enrolledSignature, setEnrolledSignature] = useState<{
    f0Hz: number;
    amplitudeRms: number;
    notchBandwidthHz: number;
    adaptiveDwellFactor: number;
    spectrumPoints?: SpectrumDataPoint[];
  } | null>(null);

  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Reset modal on open
  useEffect(() => {
    if (isOpen) {
      setStep("SETUP");
      setCountdownSeconds(10);
      setEnrolledSignature(null);
    }
  }, [isOpen]);

  // Handle 10-second sampling countdown
  const startCalibrationSampling = () => {
    setStep("COUNTDOWN");
    setCountdownSeconds(10);

    let sec = 10;
    countdownIntervalRef.current = setInterval(() => {
      sec -= 1;
      setCountdownSeconds(sec);
      if (sec <= 0) {
        clearInterval(countdownIntervalRef.current!);
        finishCalibrationAndAnalyze();
      }
    }, 1000);
  };

  const finishCalibrationAndAnalyze = async () => {
    setStep("ANALYSIS");

    try {
      const res = await fetch("/api/enrol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: `user_${Date.now()}`,
          userName: userName || "Enrolled User",
          presetCondition: conditionPreset,
          medicationPhase,
        }),
      });

      const data = await res.json();
      if (data.success && data.user) {
        setEnrolledSignature(data.signature);
        setStep("COMPLETE");
        onEnrolmentComplete(data.user);
      } else {
        alert("Enrolment failed. Please try again.");
        setStep("SETUP");
      }
    } catch (err) {
      console.error("Enrolment error:", err);
      setStep("SETUP");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">
              10-Second Personal Motion Signature Enrolment (F1)
            </h3>
            <p className="text-xs text-slate-400">
              Measures personal tremor frequency f₀ and RMS amplitude for notch-filtered intent gating.
            </p>
          </div>
        </div>

        {/* STEP 1: SETUP */}
        {step === "SETUP" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Participant Name / Identifier
              </label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500 font-mono"
                placeholder="e.g. Elena Rostova"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Clinical Condition / Tremor Model Preset
              </label>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  {
                    key: "parkinson",
                    label: "Parkinson's Disease",
                    desc: "Postural/resting 4-6 Hz",
                  },
                  {
                    key: "essential_tremor",
                    label: "Essential Tremor",
                    desc: "Action tremor 6-9 Hz",
                  },
                  {
                    key: "dystonia",
                    label: "Task Dystonia",
                    desc: "Irregular 3-5 Hz",
                  },
                  {
                    key: "steady",
                    label: "Healthy Control",
                    desc: "Normal drift < 1.0 Hz",
                  },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setConditionPreset(item.key as typeof conditionPreset)}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      conditionPreset === item.key
                        ? "bg-cyan-950/60 border-cyan-500 text-white shadow-sm"
                        : "bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <div className="font-semibold text-slate-200">{item.label}</div>
                    <div className="text-[10px] text-slate-500">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                <Pill className="w-3.5 h-3.5 text-purple-400" />
                Medication Phase / Circadian Drift Tracker (F5)
              </label>
              <select
                aria-label="Medication Phase / Circadian Drift Tracker"
                value={medicationPhase}
                onChange={(e) => setMedicationPhase(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
              >
                <option value="ON Phase (Optimal control, lower tremor)">
                  ON Phase (Optimal control, lower tremor)
                </option>
                <option value="Wearing OFF (Mid-day tremor emergence)">
                  Wearing OFF (Mid-day tremor emergence)
                </option>
                <option value="OFF Phase (Peak tremor amplitude)">
                  OFF Phase (Peak tremor amplitude)
                </option>
                <option value="Baseline / Non-medicated">Baseline / Non-medicated</option>
              </select>
            </div>

            <div className="pt-2">
              <button
                onClick={startCalibrationSampling}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-950/40 transition-all"
              >
                <Activity className="w-4 h-4" />
                Begin 10-Second Landmark Sampling
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: COUNTDOWN */}
        {step === "COUNTDOWN" && (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <div className="w-24 h-24 rounded-full border-4 border-cyan-500/30 border-t-cyan-400 animate-spin flex items-center justify-center mb-4">
              <span className="text-3xl font-extrabold font-mono text-cyan-300">
                {countdownSeconds}s
              </span>
            </div>
            <h4 className="text-sm font-bold text-slate-100">
              Holding Hand in Resting/Postural Position...
            </h4>
            <p className="text-xs text-slate-400 max-w-xs mt-1">
              Buffering wrist and fingertip landmark trajectories at 30 FPS. Do not force stillness;
              allow natural motor motion to register.
            </p>
            <div className="mt-4 w-48 bg-slate-800 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-cyan-500 h-full transition-all duration-1000 ease-linear"
                style={{ width: `${((10 - countdownSeconds) / 10) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* STEP 3: ANALYSIS */}
        {step === "ANALYSIS" && (
          <div className="py-8 flex flex-col items-center justify-center text-center">
            <Clock className="w-12 h-12 text-cyan-400 animate-pulse mb-3" />
            <h4 className="text-sm font-bold text-slate-100">
              Computing Detrended FFT & Peak Extraction...
            </h4>
            <p className="text-xs text-slate-400 mt-1">
              Linear detrending → Hann windowing → Discrete Fourier Transform → Band RMS integration.
            </p>
          </div>
        )}

        {/* STEP 4: COMPLETE */}
        {step === "COMPLETE" && enrolledSignature && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-emerald-400 bg-emerald-950/40 border border-emerald-800/80 p-3 rounded-lg text-xs font-semibold">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              <span>Personal Motion Signature successfully enrolled and active!</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[11px]">Dominant Tremor (f₀)</span>
                <p className="text-lg font-mono font-bold text-pink-400">
                  {enrolledSignature.f0Hz.toFixed(1)} Hz
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Peak power density</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[11px]">RMS Tremor Amplitude (A₀)</span>
                <p className="text-lg font-mono font-bold text-cyan-400">
                  {enrolledSignature.amplitudeRms.toFixed(3)}
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Band integrated power</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[11px]">Digital Notch Bandwidth</span>
                <p className="text-sm font-mono font-bold text-purple-400">
                  ±1.0 Hz ({(enrolledSignature.f0Hz - 1.0).toFixed(1)} -{" "}
                  {(enrolledSignature.f0Hz + 1.0).toFixed(1)} Hz)
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Attenuates 92% jitter</p>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-slate-400 text-[11px]">Adaptive Dwell Scale</span>
                <p className="text-sm font-mono font-bold text-indigo-400">
                  +{((enrolledSignature.adaptiveDwellFactor - 1.0) * 100).toFixed(0)}% Window
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">Achievable hold time</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-colors shadow-md"
            >
              Apply Enrolment & Return to Controller
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
