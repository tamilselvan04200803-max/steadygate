"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Header } from "@/components/Header";
import { LiveCameraStream } from "@/components/LiveCameraStream";
import { MotionSpectrumPanel } from "@/components/MotionSpectrumPanel";
import { IntentFusionRadar } from "@/components/IntentFusionRadar";
import { DwellRingController } from "@/components/DwellRingController";
import { SmartHouseSimulator } from "@/components/SmartHouseSimulator";
import { ApplianceCardGrid } from "@/components/ApplianceCardGrid";
import { EnrolmentModal } from "@/components/EnrolmentModal";
import { AuditLogView } from "@/components/AuditLogView";
import { BenchmarkLab } from "@/components/BenchmarkLab";
import { PatentDisclosureView } from "@/components/PatentDisclosureView";
import { AdminAgentConsole } from "@/components/AdminAgentConsole";
import { LiveHouseScene } from "@/components/LiveHouseScene";
import {
  UserProfile,
  Appliance,
  BaselineMode,
  SpectrumDataPoint,
  IntentComponents,
  ActuationResult,
  ActuationLogItem,
  RecognizedGesture,
} from "@/lib/types";
import { calculateIntentScore } from "@/lib/steady-gate";
import {
  Activity,
  Home,
  Sliders,
  FileText,
  BarChart3,
  Award,
  CheckCircle2,
  Bot,
} from "lucide-react";

export default function SteadyGateApp() {
  // App mode: User vs Admin (agent console)
  const [appMode, setAppMode] = useState<"USER" | "ADMIN">("USER");
  const [agentAlertCount, setAgentAlertCount] = useState(0);

  // Navigation
  const [activeTab, setActiveTab] = useState<
    "CONTROLLER" | "SIMULATOR" | "APPLIANCES" | "AUDIT_LOGS" | "BENCHMARK" | "PATENT" | "ADMIN_AGENTS"
  >("CONTROLLER");

  // State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [selectedAppliance, setSelectedAppliance] = useState<Appliance | null>(null);
  const [baselineMode, setBaselineMode] = useState<BaselineMode>("STEADYGATE");
  const [isEnrolmentOpen, setIsEnrolmentOpen] = useState(false);

  // Live Vision & Gesture Signals
  const [trajectoryY, setTrajectoryY] = useState<number[]>([]);
  const [spectrumPoints, setSpectrumPoints] = useState<SpectrumDataPoint[]>([]);
  const [currentF0Hz, setCurrentF0Hz] = useState<number>(5.2);
  const [currentAmpRms, setCurrentAmpRms] = useState<number>(0.048);
  const [stabilityRaw, setStabilityRaw] = useState<number>(0.42);
  const [stabilityNorm, setStabilityNorm] = useState<number>(0.88);
  const [currentRecognizedGesture, setCurrentRecognizedGesture] =
    useState<RecognizedGesture>("OPEN_PALM");

  // Intent Subcomponents
  const [posterior, setPosterior] = useState<number>(0.92);
  const [margin, setMargin] = useState<number>(0.35);
  const [attention, setAttention] = useState<number>(0.86);
  const [sceneQuality, setSceneQuality] = useState<number>(0.92);
  const [contextPrior, setContextPrior] = useState<number>(0.90);

  // Audit Logs & Calibration History
  const [logs, setLogs] = useState<ActuationLogItem[]>([]);
  const [calibrationEvents, setCalibrationEvents] = useState<any[]>([]);
  const [recentRejectTime, setRecentRejectTime] = useState<number | null>(null);
  const [lastNotification, setLastNotification] = useState<string | null>(null);
  const [lastMqttMessage, setLastMqttMessage] = useState<{
    topic: string;
    payload: Record<string, unknown>;
    qos: number;
    gpioPin: number;
    roundTripMs: number;
  } | null>(null);

  // Fetch initial users, appliances, and logs
  const loadData = useCallback(async () => {
    try {
      const [uRes, aRes, lRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/appliances"),
        fetch("/api/logs"),
      ]);

      const [uData, aData, lData] = await Promise.all([
        uRes.json(),
        aRes.json(),
        lRes.json(),
      ]);

      if (uData.success && uData.users.length > 0) {
        setUsers(uData.users);
        if (!selectedUser) setSelectedUser(uData.users[0]);
      }

      if (aData.success && aData.appliances.length > 0) {
        setAppliances(aData.appliances);
        if (!selectedAppliance) setSelectedAppliance(aData.appliances[0]);
      }

      if (lData.success) {
        setLogs(lData.logs || []);
        setCalibrationEvents(lData.calibrationEvents || []);
      }
    } catch (err) {
      console.error("Initial load error:", err);
    }
  }, [selectedUser, selectedAppliance]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Poll open agent alert count for header badge (even in user mode)
  useEffect(() => {
    const pull = async () => {
      try {
        const res = await fetch("/api/agents?status=OPEN&limit=50");
        const data = await res.json();
        if (data.success) {
          const crit = (data.findings || []).filter(
            (f: { severity: string }) => f.severity === "CRITICAL" || f.severity === "HIGH"
          ).length;
          setAgentAlertCount(crit || data.stats?.openTotal || 0);
        }
      } catch {
        /* ignore */
      }
    };
    pull();
    const id = setInterval(pull, 30000);
    return () => clearInterval(id);
  }, []);

  // Compute Fused Intent I in real-time
  const fusedIntent = calculateIntentScore({
    posterior,
    margin,
    attention,
    stabilityNorm,
    sceneQuality,
    contextPrior,
  });

  const currentIntentComponents: IntentComponents = {
    posterior,
    margin,
    attention,
    stabilityRaw,
    stabilityNorm,
    sceneQuality,
    contextPrior,
    fusedIntent,
  };

  // Trajectory update from Live Camera / Simulator
  const handleTrajectoryUpdate = useCallback(
    (data: {
      trajectoryY: number[];
      spectrumPoints: SpectrumDataPoint[];
      currentF0Hz: number;
      currentAmpRms: number;
      stabilityRaw: number;
      stabilityNorm: number;
    }) => {
      setTrajectoryY(data.trajectoryY);
      setSpectrumPoints(data.spectrumPoints);
      setCurrentF0Hz(data.currentF0Hz);
      setCurrentAmpRms(data.currentAmpRms);
      setStabilityRaw(data.stabilityRaw);
      setStabilityNorm(data.stabilityNorm);
    },
    []
  );

  // Real-time gesture recognition handler
  const handleGestureRecognized = useCallback(
    (gesture: RecognizedGesture, conf: number, mrg: number) => {
      setCurrentRecognizedGesture(gesture);

      // Smart routing: if gesture is specific, auto-align target device if appropriate
      if (gesture === "VICTORY") {
        const fanApp = appliances.find((a) => a.id === "fan_table");
        if (fanApp && selectedAppliance?.id !== "fan_table") {
          setSelectedAppliance(fanApp);
        }
      } else if (gesture === "POINTING_UP") {
        const acApp = appliances.find((a) => a.id === "ac_living");
        if (acApp && selectedAppliance?.id !== "ac_living") {
          setSelectedAppliance(acApp);
        }
      }
    },
    [appliances, selectedAppliance]
  );

  // Direct Appliance Parameter Update (e.g. from Smart House simulator)
  const handleDirectApplianceUpdate = async (params: {
    id: string;
    powerState?: string;
    fanSpeed?: number;
    temperature?: number;
    brightness?: number;
  }) => {
    try {
      const res = await fetch("/api/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();
      if (!data.success && data.error === "R2_REQUIRES_INTENT_GATE") {
        setLastNotification(
          "⛔ R2 hazard blocked: use SteadyGate dwell + THUMBS_UP handshake (or Admin override)."
        );
        setTimeout(() => setLastNotification(null), 5000);
        return;
      }
      if (data.success && data.appliance) {
        setAppliances((prev) =>
          prev.map((a) => (a.id === data.appliance.id ? data.appliance : a))
        );
        if (selectedAppliance?.id === data.appliance.id) {
          setSelectedAppliance(data.appliance);
        }

        // Emit simulated MQTT message
        setLastMqttMessage({
          topic: data.appliance.mqttTopic || `home/device/${data.appliance.id}`,
          payload: {
            power: data.appliance.powerState,
            fanSpeed: data.appliance.fanSpeed,
            airRpm: data.appliance.airRpm,
            airflowCfm: data.appliance.airflowCfm,
            temperature: data.appliance.temperature,
            brightness: data.appliance.brightness,
            activeWattage: data.appliance.activeWattage,
          },
          qos: 1,
          gpioPin: data.appliance.espPin || 12,
          roundTripMs: 12 + Math.floor(Math.random() * 6),
        });
      }
    } catch (err) {
      console.error("Direct update error:", err);
    }
  };

  // Execute Actuation against API
  const handleExecuteActuation = async (params: {
    applianceId: string;
    gesture: string;
    dwellTimeHeldMs: number;
    isSecondaryHandshakeGesture?: boolean;
    wasReAttempt?: boolean;
  }): Promise<ActuationResult | null> => {
    if (!selectedUser || !selectedAppliance) return null;

    try {
      const res = await fetch("/api/actuate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applianceId: params.applianceId,
          userId: selectedUser.id,
          gesture: params.gesture || currentRecognizedGesture,
          posterior,
          top2Posterior: Math.max(0, posterior - margin),
          attention,
          stabilityRaw,
          stabilityNorm,
          sceneQuality,
          contextPrior,
          dwellTimeHeldMs: params.dwellTimeHeldMs,
          baselineMode,
          isSecondaryHandshakeGesture: !!params.isSecondaryHandshakeGesture,
          wasReAttempt: !!params.wasReAttempt,
        }),
      });

      const data = await res.json();
      if (data.success && data.decision) {
        // Refresh logs and appliance state
        loadData();

        if (data.mqttMessage) {
          setLastMqttMessage(data.mqttMessage);
        }

        if (data.decision.status === "REJECTED") {
          setRecentRejectTime(Date.now());
          setLastNotification(`Refused: ${data.decision.rejectExplanation}`);
        } else if (data.decision.status === "ACTUATED") {
          setRecentRejectTime(null);
          setLastNotification(
            `✓ Actuated ${data.appliance.name} [${data.appliance.powerState}] (ACK Verified)`
          );
        } else if (data.decision.status === "HANDSHAKE_PENDING") {
          setLastNotification("⚠️ R2 Risk Gating: Awaiting secondary THUMBS_UP handshake");
        }

        setTimeout(() => setLastNotification(null), 5000);
        return data.decision;
      }
    } catch (err) {
      console.error("Actuation execution failed:", err);
    }
    return null;
  };

  const handleClearLogs = async () => {
    try {
      await fetch("/api/logs", { method: "DELETE" });
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const handleEnrolmentComplete = (newUser: UserProfile) => {
    setUsers((prev) => [newUser, ...prev.filter((u) => u.id !== newUser.id)]);
    setSelectedUser(newUser);
    loadData();
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Header */}
      <Header
        users={users}
        selectedUser={selectedUser}
        onSelectUser={setSelectedUser}
        baselineMode={baselineMode}
        onSelectBaselineMode={setBaselineMode}
        onOpenEnrolment={() => setIsEnrolmentOpen(true)}
        isSimulating={true}
        appMode={appMode}
        onAppModeChange={(mode) => {
          setAppMode(mode);
          if (mode === "ADMIN") setActiveTab("ADMIN_AGENTS");
          else if (activeTab === "ADMIN_AGENTS") setActiveTab("CONTROLLER");
        }}
        agentAlertCount={agentAlertCount}
      />

      {/* Live Toast Notification Banner */}
      {lastNotification && (
        <div className="bg-cyan-950/80 border-b border-cyan-800 text-xs px-4 py-2 flex items-center justify-between text-cyan-200 transition-all">
          <div className="max-w-7xl mx-auto w-full flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />
            <span>{lastNotification}</span>
          </div>
        </div>
      )}

      {/* Navigation Tab Bar */}
      <div className="border-b border-slate-800/80 bg-slate-900/60 sticky top-16 z-30 px-4">
        <div className="max-w-7xl mx-auto flex items-center space-x-1 overflow-x-auto py-1.5 scrollbar-none">
          <button
            onClick={() => setActiveTab("CONTROLLER")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "CONTROLLER"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Live Intent Controller & Kinematics
          </button>

          <button
            onClick={() => setActiveTab("SIMULATOR")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "SIMULATOR"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            Smart House Virtual Simulator
          </button>

          <button
            onClick={() => setActiveTab("APPLIANCES")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "APPLIANCES"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            IoT Appliances Grid ({appliances.length})
          </button>

          <button
            onClick={() => setActiveTab("AUDIT_LOGS")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "AUDIT_LOGS"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Audit Trail & Telemetry ({logs.length})
          </button>

          <button
            onClick={() => setActiveTab("BENCHMARK")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "BENCHMARK"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Evaluation Lab & Ablation (§5)
          </button>

          <button
            onClick={() => setActiveTab("PATENT")}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
              activeTab === "PATENT"
                ? "bg-cyan-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            Patent Disclosure & Claims
          </button>

          {appMode === "ADMIN" && (
            <button
              onClick={() => setActiveTab("ADMIN_AGENTS")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${
                activeTab === "ADMIN_AGENTS"
                  ? "bg-amber-500 text-slate-950 shadow-sm"
                  : "text-amber-300 hover:text-amber-100 hover:bg-amber-950/40"
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              AI Agent Debug Council
              {agentAlertCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-black">
                  {agentAlertCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {/* TAB 1: LIVE CONTROLLER */}
        {activeTab === "CONTROLLER" && (
          <div className="space-y-6">
            {/* Top Grid: Camera Stream & Spectrum Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: Real-Time Hand Kinematics & Gesture Recognizer */}
              <LiveCameraStream
                user={selectedUser}
                onTrajectoryUpdate={handleTrajectoryUpdate}
                posterior={posterior}
                setPosterior={setPosterior}
                margin={margin}
                setMargin={setMargin}
                attention={attention}
                setAttention={setAttention}
                sceneQuality={sceneQuality}
                setSceneQuality={setSceneQuality}
                onGestureRecognized={handleGestureRecognized}
                onPersonalizeSuccess={(u) => {
                  setSelectedUser(u);
                  loadData();
                }}
              />

              {/* Right: Personal Motion Signature (FFT + Notch + S_norm) */}
              <MotionSpectrumPanel
                user={selectedUser}
                spectrumPoints={spectrumPoints}
                currentF0Hz={currentF0Hz}
                currentAmpRms={currentAmpRms}
                stabilityRaw={stabilityRaw}
                stabilityNorm={stabilityNorm}
                waveformY={trajectoryY}
              />
            </div>

            {/* Bottom Grid: Fused Intent Radar & Dwell Ring Controller */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Left: 6-Component Calibrated Intent Fusion Engine (F3) */}
              <IntentFusionRadar
                intent={currentIntentComponents}
                user={selectedUser}
              />

              {/* Right: Dynamic Adaptive Dwell Ring & R2 Handshake Controller (F4) */}
              <DwellRingController
                appliance={selectedAppliance}
                user={selectedUser}
                fusedIntent={fusedIntent}
                baselineMode={baselineMode}
                onExecuteActuation={handleExecuteActuation}
                recentRejectTime={recentRejectTime}
              />
            </div>

            {/* Live physical house — you see the lamp glow / fan spin the moment a gesture actuates */}
            <LiveHouseScene
              appliances={appliances}
              selectedId={selectedAppliance?.id}
              onSelect={(a) => setSelectedAppliance(a)}
              compact
            />

            {/* Quick-Pick Appliance Bar */}
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-300">
                  Target Appliance Selector (Click to Switch Target)
                </span>
                <span className="text-[11px] text-cyan-400">
                  Active: <strong>{selectedAppliance?.name}</strong> ({selectedAppliance?.riskTier})
                </span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {appliances.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => setSelectedAppliance(app)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-all whitespace-nowrap flex items-center gap-2 ${
                      selectedAppliance?.id === app.id
                        ? "bg-cyan-950 border-cyan-500 text-white shadow-sm"
                        : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                    }`}
                  >
                    <span
                      className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                        app.riskTier === "R2"
                          ? "bg-rose-950 text-rose-400 border border-rose-900"
                          : app.riskTier === "R1"
                          ? "bg-blue-950 text-blue-400 border border-blue-900"
                          : "bg-emerald-950 text-emerald-400 border border-emerald-900"
                      }`}
                    >
                      {app.riskTier}
                    </span>
                    <span>{app.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        app.powerState === "ON"
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {app.powerState}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SMART HOUSE VIRTUAL SIMULATOR */}
        {activeTab === "SIMULATOR" && (
          <div className="space-y-6">
          <LiveHouseScene
            appliances={appliances}
            selectedId={selectedAppliance?.id}
            onSelect={(a) => setSelectedAppliance(a)}
          />
          <SmartHouseSimulator
            appliances={appliances}
            selectedAppliance={selectedAppliance}
            onSelectAppliance={(app) => setSelectedAppliance(app)}
            onUpdateAppliance={handleDirectApplianceUpdate}
            lastMqttMessage={lastMqttMessage}
            currentRecognizedGesture={currentRecognizedGesture}
          />
          </div>
        )}

        {/* TAB 3: PHYSICAL APPLIANCES GRID */}
        {activeTab === "APPLIANCES" && (
          <ApplianceCardGrid
            appliances={appliances}
            selectedAppliance={selectedAppliance}
            onSelectAppliance={(app) => {
              setSelectedAppliance(app);
              setActiveTab("CONTROLLER");
            }}
          />
        )}

        {/* TAB 4: AUDIT LOGS & CALIBRATION TRAIL */}
        {activeTab === "AUDIT_LOGS" && (
          <AuditLogView
            logs={logs}
            onClearLogs={handleClearLogs}
            calibrationEvents={calibrationEvents}
          />
        )}

        {/* TAB 5: BENCHMARK & ABLATION LAB */}
        {activeTab === "BENCHMARK" && <BenchmarkLab />}

        {/* TAB 6: PATENT DISCLOSURE */}
        {activeTab === "PATENT" && <PatentDisclosureView />}

        {/* TAB 7: ADMIN MULTI-AGENT COUNCIL */}
        {activeTab === "ADMIN_AGENTS" && appMode === "ADMIN" && <AdminAgentConsole />}
      </main>

      {/* 10-Second Enrolment Wizard Modal */}
      <EnrolmentModal
        isOpen={isEnrolmentOpen}
        onClose={() => setIsEnrolmentOpen(false)}
        onEnrolmentComplete={handleEnrolmentComplete}
      />

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950 py-4 px-4 text-center text-xs text-slate-500">
        <p>
          SteadyGate — Tremor-Aware, Risk-Tiered Intent Gating for Camera-Based Smart-Home Actuation (RHG-Home v3).
        </p>
        <p className="mt-1 text-[11px] text-slate-600">
          Real-time kinematic hand recognition with self-optimizing prototypes &amp; multi-room IoT smart house emulation.
        </p>
      </footer>
    </div>
  );
}
