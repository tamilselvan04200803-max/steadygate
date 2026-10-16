"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Header, ActiveTab } from "@/components/Header";
import { LiveCameraStream } from "@/components/LiveCameraStream";
import { DwellRingController, HandshakeStage } from "@/components/DwellRingController";
import { ApplianceCardGrid } from "@/components/ApplianceCardGrid";
import { SmartHouseSimulator } from "@/components/SmartHouseSimulator";
import { LiveHouseScene } from "@/components/LiveHouseScene";
import { AuditLogView } from "@/components/AuditLogView";
import { EnrolmentModal } from "@/components/EnrolmentModal";
import AdminGestureTrainer from "@/components/AdminGestureTrainer";
import { setAdminTrainedModel } from "@/lib/hand-gesture-engine";
import {
  DEFAULT_GESTURE_APPLIANCE_MAP,
  getDefaultBindingForGesture,
  DefaultGestureApplianceBinding,
} from "@/lib/default-gesture-map";
import {
  UserProfile,
  Appliance,
  ActuationLogItem,
  RejectCode,
  RecognizedGesture,
  SpectrumDataPoint,
  HandLandmark2D,
  HandParameters,
} from "@/lib/types";
import {
  Activity,
  Sparkles,
  Bell,
  Hand,
  Fan,
  Zap,
  Database,
  Sliders,
  Flame,
  RotateCcw,
  Save,
  Clock,
} from "lucide-react";

interface DashboardNotification {
  id: string;
  title: string;
  message: string;
  gesture?: string;
  applianceId?: string;
  powerState?: "ON" | "OFF" | "STANDBY";
  timestamp: string;
}

export default function SteadyGateApp() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<UserProfile | null>(null);
  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [selectedAppliance, setSelectedAppliance] = useState<Appliance | null>(null);
  const [logs, setLogs] = useState<ActuationLogItem[]>([]);
  const [calibrationEvents, setCalibrationEvents] = useState<any[]>([]);

  const appliancesRef = useRef<Appliance[]>([]);
  useEffect(() => {
    appliancesRef.current = appliances;
  }, [appliances]);

  const selectedProfileRef = useRef<UserProfile | null>(null);
  useEffect(() => {
    selectedProfileRef.current = selectedProfile;
  }, [selectedProfile]);

  // Dynamic User-Customizable Gesture-to-Appliance Mappings
  const [gestureMappings, setGestureMappings] = useState<DefaultGestureApplianceBinding[]>(
    DEFAULT_GESTURE_APPLIANCE_MAP
  );
  const [showGestureCustomizer, setShowGestureCustomizer] = useState<boolean>(false);
  const [savingMappings, setSavingMappings] = useState<boolean>(false);
  const [expandedCameraView, setExpandedCameraView] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>("CONTROLLER");
  const [filterEnabled, setFilterEnabled] = useState<boolean>(true);
  const [baselineMode, setBaselineMode] = useState<
    "RAW_MEDIA_PIPE" | "FIXED_DWELL_800MS" | "STEADYGATE"
  >("STEADYGATE");
  const [isEnrolmentOpen, setIsEnrolmentOpen] = useState<boolean>(false);

  // Auto-actuate appliance when holding a recognized gesture for its requiredHoldMs
  const [autoGestureActuation, setAutoGestureActuation] = useState<boolean>(true);
  const [gestureHoldProgress, setGestureHoldProgress] = useState<number>(0);
  const [gestureHoldElapsedMs, setGestureHoldElapsedMs] = useState<number>(0);

  // Dashboard notifications (Toast + Banner)
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [backgroundObsCount, setBackgroundObsCount] = useState<number>(0);

  // Live 30 FPS Telemetry State
  const [posterior, setPosterior] = useState<number>(0.94);
  const [margin, setMargin] = useState<number>(0.65);
  const [attention, setAttention] = useState<number>(0.92);
  const [sceneQuality, setSceneQuality] = useState<number>(0.88);
  const [detectedGesture, setDetectedGesture] = useState<RecognizedGesture>("FIST");
  const [currentF0Hz, setCurrentF0Hz] = useState<number>(5.5);
  const [currentAmpRms, setCurrentAmpRms] = useState<number>(0.02);
  const [stabilityRaw, setStabilityRaw] = useState<number>(0.62);
  const [stabilityNorm, setStabilityNorm] = useState<number>(0.89);
  const [liveTrajectoryY, setLiveTrajectoryY] = useState<number[]>([]);
  const [, setSpectrumPoints] = useState<SpectrumDataPoint[]>([]);
  const [liveHandFrame, setLiveHandFrame] = useState<{
    landmarks: HandLandmark2D[];
    handParams: HandParameters;
    gesture: RecognizedGesture;
    confidence: number;
    webcamActive: boolean;
  } | null>(null);

  const liveIntentScore = Number(
    Math.min(
      1,
      Math.max(
        0,
        0.35 * posterior + 0.25 * stabilityNorm + 0.2 * attention + 0.2 * sceneQuality
      )
    ).toFixed(3)
  );

  const pushNotification = useCallback(
    (notif: Omit<DashboardNotification, "id" | "timestamp">) => {
      const entry: DashboardNotification = {
        ...notif,
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
      };
      setNotifications((prev) => [entry, ...prev.slice(0, 5)]);
    },
    []
  );

  // Initial Data Load
  const fetchAllData = useCallback(async () => {
    try {
      const [profRes, appRes, logRes, userDataRes, mapRes, adminRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/appliances"),
        fetch("/api/actuate"),
        fetch("/api/user-data?limit=20"),
        fetch("/api/gesture-map"),
        fetch("/api/admin-train"),
      ]);

      const profData = await profRes.json();
      const appData = await appRes.json();
      const logData = await logRes.json();
      const userData = await userDataRes.json();
      const mapData = await mapRes.json();
      const adminData = await adminRes.json();

      if (adminData?.model) {
        setAdminTrainedModel(adminData.model);
      }

      const loadedUsers: UserProfile[] = profData.users || profData.profiles || [];
      if (loadedUsers.length > 0) {
        setProfiles(loadedUsers);
        setSelectedProfile((prev) => prev || loadedUsers[0]);
      }

      if (appData.appliances?.length > 0) {
        setAppliances(appData.appliances);
        setSelectedAppliance((prev) => {
          if (prev) {
            return (
              appData.appliances.find((a: Appliance) => a.id === prev.id) ||
              appData.appliances[0]
            );
          }
          return (
            appData.appliances.find((a: Appliance) => a.id === "heater_radiant") ||
            appData.appliances[0]
          );
        });
      }

      if (Array.isArray(mapData?.mappings) && mapData.mappings.length > 0) {
        setGestureMappings(mapData.mappings);
      }

      if (logData.logs) setLogs(logData.logs);
      if (logData.calibrationEvents) setCalibrationEvents(logData.calibrationEvents);
      if (userData?.recentObservations) {
        setBackgroundObsCount(userData.recentObservations.length);
      }
    } catch (error) {
      console.error("Failed to fetch initial SteadyGate data:", error);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const handleTrajectoryUpdate = useCallback(
    (data: {
      trajectoryY: number[];
      spectrumPoints: SpectrumDataPoint[];
      currentF0Hz: number;
      currentAmpRms: number;
      stabilityRaw: number;
      stabilityNorm: number;
    }) => {
      setLiveTrajectoryY(data.trajectoryY);
      setSpectrumPoints(data.spectrumPoints);
      setCurrentF0Hz(data.currentF0Hz);
      setCurrentAmpRms(data.currentAmpRms);
      setStabilityRaw(data.stabilityRaw);
      setStabilityNorm(data.stabilityNorm);
    },
    []
  );

  const handleGestureRecognized = useCallback(
    (gesture: RecognizedGesture, confidence: number, marg: number) => {
      setDetectedGesture(gesture);
      setPosterior(confidence);
      setMargin(marg);
    },
    []
  );

  // Execute Dynamic Gesture -> Configured Appliance Actuation
  const triggerGestureActuation = useCallback(
    async (
      gestureName: string,
      sourceLabel: "AUTO_GESTURE" | "QUICK_GESTURE_BTN",
      heldMsOverride?: number
    ) => {
      const binding = getDefaultBindingForGesture(gestureName, gestureMappings);
      const currentProf = selectedProfileRef.current || selectedProfile;
      if (!binding || !currentProf) return;

      const currentList = appliancesRef.current.length > 0 ? appliancesRef.current : appliances;
      const targetApp = currentList.find((a) => a.id === binding.defaultApplianceId);
      if (!targetApp) return;

      const heldMs = heldMsOverride ?? binding.requiredHoldMs;
      const isCycleFan = binding.command === "CYCLE_FAN_SPEED";
      const nextFanSpeed = isCycleFan
        ? ((targetApp.fanSpeed || 0) % 4) + 1
        : binding.command === "SET_POWER_OFF"
        ? 0
        : targetApp.powerState === "ON"
        ? 0
        : Math.max(1, targetApp.fanSpeed || 2);

      const desiredPower: "ON" | "OFF" =
        binding.command === "SET_POWER_ON"
          ? "ON"
          : binding.command === "SET_POWER_OFF"
          ? "OFF"
          : isCycleFan
          ? "ON"
          : targetApp.powerState === "ON"
          ? "OFF"
          : "ON";

      // Optimistic state update so UI reflects ON/OFF immediately
      const optimisticApp: Appliance = {
        ...targetApp,
        powerState: desiredPower,
        ...(targetApp.id === "fan_table"
          ? {
              fanSpeed: desiredPower === "OFF" ? 0 : nextFanSpeed,
              airRpm: desiredPower === "OFF" ? 0 : 420 + nextFanSpeed * 250,
              activeWattage: desiredPower === "OFF" ? 0 : 18 + nextFanSpeed * 12,
              targetValue: desiredPower === "OFF" ? 0 : nextFanSpeed,
            }
          : targetApp.id === "lamp_desk"
          ? {
              brightness: desiredPower === "ON" ? 85 : 0,
              activeWattage: desiredPower === "ON" ? 12 : 0,
              targetValue: desiredPower === "ON" ? 85 : 0,
            }
          : targetApp.id === "heater_radiant"
          ? {
              activeWattage: desiredPower === "ON" ? 2000 : 0,
              targetValue: desiredPower === "ON" ? 2000 : 0,
            }
          : targetApp.id === "geyser_bath"
          ? {
              activeWattage: desiredPower === "ON" ? 3000 : 0,
              targetValue: desiredPower === "ON" ? 65 : 0,
            }
          : targetApp.id === "ac_living"
          ? {
              activeWattage: desiredPower === "ON" ? 1250 : 0,
            }
          : targetApp.id === "blinds_window"
          ? {
              targetValue: desiredPower === "ON" ? 100 : 0,
              activeWattage: desiredPower === "ON" ? 15 : 0,
            }
          : targetApp.id === "tv_ambient"
          ? {
              targetValue: desiredPower === "ON" ? 35 : 0,
              brightness: desiredPower === "ON" ? 75 : 0,
              activeWattage: desiredPower === "ON" ? 110 : 0,
            }
          : targetApp.id === "door_deadbolt"
          ? {
              targetValue: desiredPower === "ON" ? 1 : 0,
              activeWattage: desiredPower === "ON" ? 8 : 0,
            }
          : {}),
      };

      appliancesRef.current = currentList.map((a) =>
        a.id === optimisticApp.id ? optimisticApp : a
      );
      setAppliances(appliancesRef.current);
      setSelectedAppliance(optimisticApp);

      try {
        const res = await fetch("/api/actuate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            applianceId: targetApp.id,
            userId: currentProf.id,
            userName: currentProf.name,
            gesture: gestureName,
            command: binding.command,
            targetPowerState: desiredPower,
            fanSpeed: isCycleFan ? nextFanSpeed : undefined,
            status: "ACTUATED",
            rejectCode: "NONE",
            intentScore: liveIntentScore,
            stabilityNorm,
            posterior,
            margin,
            attention,
            dwellTimeMs: heldMs,
            dwellRequiredMs: binding.requiredHoldMs,
            handshakeStage: "CONFIRMED",
            baselineMode: "STEADYGATE",
            calibratedNudge: false,
          }),
        });

        const data = await res.json();
        const updated: Appliance | undefined =
          data.updatedAppliance || data.result?.appliance || data.appliance;
        if (updated) {
          setAppliances((prev) => {
            const next = prev.map((a) => (a.id === updated.id ? updated : a));
            appliancesRef.current = next;
            return next;
          });
          setSelectedAppliance(updated);

          const isFan = updated.id === "fan_table";
          const detailSuffix = isFan
            ? updated.powerState === "ON"
              ? `(Speed ${updated.fanSpeed} · ${updated.airRpm} RPM — Fan Spinning)`
              : `(0 RPM — Fan Stopped)`
            : `(${updated.targetValue} ${updated.unit} · ${updated.activeWattage}W)`;

          pushNotification({
            title: `${binding.icon} ${gestureName} (${(heldMs / 1000).toFixed(1)}s Hold) → ${
              updated.name
            } ${updated.powerState}`,
            message: `${updated.name} [${binding.amperageRating}] switched ${
              updated.powerState
            } ${detailSuffix} via ${
              sourceLabel === "AUTO_GESTURE"
                ? `sustained ${(binding.requiredHoldMs / 1000).toFixed(1)}s gesture hold`
                : "gesture trigger"
            }.`,
            gesture: gestureName,
            applianceId: updated.id,
            powerState: updated.powerState,
          });
        }
        if (data.log) {
          setLogs((prev) => [data.log, ...prev]);
        }
      } catch (err) {
        console.error("Failed gesture actuation:", err);
      }
    },
    [
      appliances,
      selectedProfile,
      gestureMappings,
      liveIntentScore,
      stabilityNorm,
      posterior,
      margin,
      attention,
      pushNotification,
    ]
  );

  // Dynamic Sustained Gesture Hold Watcher (latches after each actuation so static synthetic hand does not infinite-loop toggle)
  const gestureHoldStateRef = useRef<{
    gesture: string;
    elapsedMs: number;
    lastActuatedAtMs: number;
    actuatedForCurrentHold: boolean;
  }>({
    gesture: "FIST",
    elapsedMs: 0,
    lastActuatedAtMs: 0,
    actuatedForCurrentHold: true,
  });

  const handleSyntheticGestureSelect = useCallback((gesture: RecognizedGesture) => {
    latestGestureRef.current = gesture;
    setDetectedGesture(gesture);
    gestureHoldStateRef.current = {
      gesture,
      elapsedMs: 0,
      lastActuatedAtMs: 0,
      actuatedForCurrentHold: false,
    };
    setGestureHoldElapsedMs(0);
    setGestureHoldProgress(0);
  }, []);

  const latestGestureRef = useRef<string>(detectedGesture);
  useEffect(() => {
    latestGestureRef.current = detectedGesture;
  }, [detectedGesture]);

  const latestMappingsRef = useRef(gestureMappings);
  useEffect(() => {
    latestMappingsRef.current = gestureMappings;
  }, [gestureMappings]);

  const triggerGestureActuationRef = useRef(triggerGestureActuation);
  useEffect(() => {
    triggerGestureActuationRef.current = triggerGestureActuation;
  }, [triggerGestureActuation]);

  useEffect(() => {
    if (!autoGestureActuation) {
      setGestureHoldProgress(0);
      setGestureHoldElapsedMs(0);
      return;
    }

    const TICK_MS = 100;
    const timer = setInterval(() => {
      const g = latestGestureRef.current;
      const binding = getDefaultBindingForGesture(g, latestMappingsRef.current);
      const now = Date.now();

      if (!binding || g === "UNKNOWN" || g === "NONE") {
        gestureHoldStateRef.current.gesture = "UNKNOWN";
        gestureHoldStateRef.current.elapsedMs = 0;
        gestureHoldStateRef.current.actuatedForCurrentHold = false;
        setGestureHoldProgress(0);
        setGestureHoldElapsedMs(0);
        return;
      }

      if (gestureHoldStateRef.current.gesture !== g) {
        gestureHoldStateRef.current.gesture = g;
        gestureHoldStateRef.current.elapsedMs = TICK_MS;
        gestureHoldStateRef.current.actuatedForCurrentHold = false;
      } else {
        if (gestureHoldStateRef.current.actuatedForCurrentHold) {
          return;
        }
        if (now - gestureHoldStateRef.current.lastActuatedAtMs < 1200) {
          return;
        }
        gestureHoldStateRef.current.elapsedMs += TICK_MS;
      }

      const reqMs = Math.max(400, binding.requiredHoldMs || 1000);
      const elapsed = gestureHoldStateRef.current.elapsedMs;
      const pct = Math.min(100, Math.round((elapsed / reqMs) * 100));

      setGestureHoldElapsedMs(elapsed);
      setGestureHoldProgress(pct);

      if (elapsed >= reqMs) {
        gestureHoldStateRef.current.elapsedMs = 0;
        gestureHoldStateRef.current.lastActuatedAtMs = now;
        gestureHoldStateRef.current.actuatedForCurrentHold = true;
        setGestureHoldProgress(100);
        setGestureHoldElapsedMs(reqMs);
        triggerGestureActuationRef.current(g, "AUTO_GESTURE", reqMs);
      }
    }, TICK_MS);

    return () => clearInterval(timer);
  }, [autoGestureActuation]);

  // Save custom gesture-to-appliance mappings
  const handleUpdateGestureMapping = (
    gesture: RecognizedGesture,
    patch: Partial<DefaultGestureApplianceBinding>
  ) => {
    setGestureMappings((prev) =>
      prev.map((m) => {
        if (m.gesture !== gesture) return m;
        const updated = { ...m, ...patch };
        if (patch.defaultApplianceId) {
          const foundApp = appliances.find((a) => a.id === patch.defaultApplianceId);
          if (foundApp) {
            updated.defaultApplianceName = foundApp.name;
            updated.isHighAmpere = foundApp.riskTier === "R2" || foundApp.id === "ac_living";
            updated.amperageRating =
              foundApp.id === "heater_radiant"
                ? "9.1 A (2000 W)"
                : foundApp.id === "geyser_bath"
                ? "13.6 A (3000 W)"
                : foundApp.id === "ac_living"
                ? "5.7 A (1250 W)"
                : `${((foundApp.activeWattage || 40) / 220).toFixed(2)} A`;
          }
        }
        return updated;
      })
    );
  };

  const handleSaveCustomMappings = async () => {
    setSavingMappings(true);
    try {
      const res = await fetch("/api/gesture-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings: gestureMappings }),
      });
      const data = await res.json();
      if (data.success) {
        pushNotification({
          title: "Custom Gesture → Appliance Mappings Saved!",
          message: `Persisted ${gestureMappings.length} dynamic gesture bindings & hold durations to storage/gesture_mappings.json.`,
        });
      }
    } catch (err) {
      console.error("Failed to save gesture mappings:", err);
    } finally {
      setSavingMappings(false);
    }
  };

  const handleResetMappings = async () => {
    setSavingMappings(true);
    try {
      const res = await fetch("/api/gesture-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetToDefault: true }),
      });
      const data = await res.json();
      if (data.mappings) {
        setGestureMappings(data.mappings);
        pushNotification({
          title: "Gesture Mappings Reset to Ergonomic Defaults",
          message:
            "Restored FIST → Space Heater (2.5s), OPEN_PALM → Fan (0.8s), THUMBS_UP → AC (2.2s), CALL_ME → Water Geyser (2.6s).",
        });
      }
    } finally {
      setSavingMappings(false);
    }
  };

  // Continuous Background User Data Observation Collector (writes to storage/ and logs/ every 4s)
  const latestStateForBgRef = useRef({
    selectedProfile,
    selectedAppliance,
    detectedGesture,
    posterior,
    currentF0Hz,
    currentAmpRms,
    stabilityRaw,
    stabilityNorm,
    liveIntentScore,
    filterEnabled,
  });

  useEffect(() => {
    latestStateForBgRef.current = {
      selectedProfile,
      selectedAppliance,
      detectedGesture,
      posterior,
      currentF0Hz,
      currentAmpRms,
      stabilityRaw,
      stabilityNorm,
      liveIntentScore,
      filterEnabled,
    };
  }, [
    selectedProfile,
    selectedAppliance,
    detectedGesture,
    posterior,
    currentF0Hz,
    currentAmpRms,
    stabilityRaw,
    stabilityNorm,
    liveIntentScore,
    filterEnabled,
  ]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const st = latestStateForBgRef.current;
      if (!st.selectedProfile) return;

      try {
        const obsRes = await fetch("/api/user-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: st.selectedProfile.id,
            userName: st.selectedProfile.name,
            source: "BACKGROUND_TELEMETRY",
            gesture: st.detectedGesture,
            confidence: st.posterior,
            tremorHz: st.currentF0Hz,
            tremorAmplitude: st.currentAmpRms,
            rawVariance: st.stabilityRaw,
            filteredVariance: Number((st.stabilityRaw * 0.25).toFixed(4)),
            stability: st.stabilityNorm,
            intentScore: st.liveIntentScore,
            palmScale: st.selectedProfile.palmScale ?? 0.2,
            fingerSpread: st.selectedProfile.fingerFlexibility ?? 0.45,
            fingerExtensions: [0.85, 0.88, 0.86, 0.82, 0.78],
            wristAngleDeg: -3.0,
            selectedApplianceId: st.selectedAppliance?.id ?? null,
            notes: `Continuous background observation (Filter=${
              st.filterEnabled ? "ON" : "OFF"
            })`,
          }),
        });

        if (obsRes.ok) {
          setBackgroundObsCount((c) => c + 1);
        }
      } catch {
        // Non-blocking background collector
      }
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Direct Appliance Update Handler (Turn ON / Turn OFF / Speed / Brightness / Temp)
  const handleDirectApplianceUpdate = async (
    applianceId: string,
    patch: Record<string, unknown>
  ) => {
    const currentList = appliancesRef.current.length > 0 ? appliancesRef.current : appliances;
    const targetApp = currentList.find((a) => a.id === applianceId);

    if (targetApp) {
      const nextPower =
        patch.powerState !== undefined
          ? (patch.powerState as "ON" | "OFF")
          : patch.fanSpeed !== undefined
          ? Number(patch.fanSpeed) > 0
            ? "ON"
            : "OFF"
          : patch.brightness !== undefined
          ? Number(patch.brightness) > 0
            ? "ON"
            : "OFF"
          : targetApp.powerState;

      const nextSpeed =
        patch.fanSpeed !== undefined
          ? Number(patch.fanSpeed)
          : nextPower === "OFF"
          ? 0
          : Math.max(1, targetApp.fanSpeed || 2);

      const optimistic: Appliance = {
        ...targetApp,
        ...(patch as Partial<Appliance>),
        powerState: nextPower,
        ...(applianceId === "fan_table"
          ? {
              fanSpeed: nextSpeed,
              airRpm: nextPower === "OFF" ? 0 : 420 + nextSpeed * 250,
              activeWattage: nextPower === "OFF" ? 0 : 18 + nextSpeed * 12,
              targetValue: nextPower === "OFF" ? 0 : nextSpeed,
            }
          : applianceId === "lamp_desk"
          ? {
              brightness:
                patch.brightness !== undefined
                  ? Number(patch.brightness)
                  : nextPower === "ON"
                  ? Math.max(10, targetApp.brightness || 80)
                  : 0,
              activeWattage: nextPower === "ON" ? 12 : 0,
              targetValue:
                patch.brightness !== undefined
                  ? Number(patch.brightness)
                  : nextPower === "ON"
                  ? Math.max(10, targetApp.brightness || 80)
                  : 0,
            }
          : applianceId === "heater_radiant"
          ? {
              activeWattage: nextPower === "ON" ? 2000 : 0,
              targetValue: nextPower === "ON" ? 2000 : 0,
            }
          : applianceId === "geyser_bath"
          ? {
              activeWattage: nextPower === "ON" ? 3000 : 0,
              targetValue: nextPower === "ON" ? 65 : 0,
            }
          : applianceId === "ac_living"
          ? {
              activeWattage: nextPower === "ON" ? 1250 : 0,
              temperature:
                patch.temperature !== undefined
                  ? Number(patch.temperature)
                  : targetApp.temperature || 22,
            }
          : applianceId === "blinds_window"
          ? {
              targetValue: nextPower === "ON" ? 100 : 0,
              activeWattage: nextPower === "ON" ? 15 : 0,
            }
          : applianceId === "tv_ambient"
          ? {
              targetValue: nextPower === "ON" ? 35 : 0,
              brightness: nextPower === "ON" ? 75 : 0,
              activeWattage: nextPower === "ON" ? 110 : 0,
            }
          : applianceId === "door_deadbolt"
          ? {
              targetValue: nextPower === "ON" ? 1 : 0,
              activeWattage: nextPower === "ON" ? 8 : 0,
            }
          : {}),
      };

      const nextList = currentList.map((a) => (a.id === applianceId ? optimistic : a));
      appliancesRef.current = nextList;
      setAppliances(nextList);
      setSelectedAppliance((prev) => (prev?.id === applianceId ? optimistic : prev));
    }

    try {
      const res = await fetch("/api/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: applianceId,
          allowR2Override: true,
          ...patch,
        }),
      });
      const data = await res.json();
      if (data.appliance) {
        const updated: Appliance = data.appliance;
        setAppliances((prev) => {
          const next = prev.map((a) => (a.id === updated.id ? updated : a));
          appliancesRef.current = next;
          return next;
        });
        setSelectedAppliance((prev) => (prev?.id === updated.id ? updated : prev));

        const isFan = updated.id === "fan_table";
        const suffix = isFan
          ? updated.powerState === "ON"
            ? `Speed ${updated.fanSpeed} · ${updated.airRpm} RPM`
            : `0 RPM (Stopped)`
          : `${updated.targetValue} ${updated.unit} (${updated.activeWattage}W)`;

        pushNotification({
          title: `${updated.name} turned ${updated.powerState}`,
          message: `Dashboard updated ${updated.name} → ${updated.powerState} (${suffix}).`,
          applianceId: updated.id,
          powerState: updated.powerState,
        });
      }
    } catch (e) {
      console.error("Direct appliance update error:", e);
    }
  };

  const handleToggleAppliancePower = (app: Appliance) => {
    const latestApp =
      appliancesRef.current.find((a) => a.id === app.id) || app;
    const nextPower = latestApp.powerState === "ON" ? "OFF" : "ON";
    handleDirectApplianceUpdate(latestApp.id, {
      powerState: nextPower,
      ...(latestApp.id === "fan_table" &&
      nextPower === "ON" &&
      (latestApp.fanSpeed || 0) === 0
        ? { fanSpeed: 2 }
        : {}),
    });
  };

  const handleCycleFanSpeed = (app: Appliance) => {
    const latestApp =
      appliancesRef.current.find((a) => a.id === app.id) || app;
    const nextSpeed = ((latestApp.fanSpeed || 0) + 1) % 5;
    handleDirectApplianceUpdate(latestApp.id, {
      fanSpeed: nextSpeed,
      powerState: nextSpeed > 0 ? "ON" : "OFF",
    });
  };

  // Handle Dwell Gate Actuation Completion
  const handleActuateComplete = async (payload: {
    status: "ACTUATED" | "REJECTED" | "HANDSHAKE_PENDING";
    rejectCode: RejectCode;
    dwellTimeMs: number;
    dwellRequiredMs: number;
    handshakeStage: HandshakeStage;
    calibratedNudge: boolean;
    command: string;
  }) => {
    const currentProf = selectedProfileRef.current || selectedProfile;
    if (!selectedAppliance || !currentProf) return;
    const currentApp =
      appliancesRef.current.find((a) => a.id === selectedAppliance.id) ||
      selectedAppliance;

    try {
      const res = await fetch("/api/actuate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applianceId: currentApp.id,
          userId: currentProf.id,
          userName: currentProf.name,
          gesture: detectedGesture,
          command: payload.command,
          targetPowerState:
            payload.command === "SET_POWER_ON"
              ? "ON"
              : payload.command === "SET_POWER_OFF"
              ? "OFF"
              : undefined,
          status: payload.status,
          rejectCode: payload.rejectCode,
          intentScore: liveIntentScore,
          stabilityNorm,
          posterior,
          margin,
          attention,
          dwellTimeMs: payload.dwellTimeMs,
          dwellRequiredMs: payload.dwellRequiredMs,
          handshakeStage: payload.handshakeStage,
          baselineMode: "STEADYGATE",
          calibratedNudge: payload.calibratedNudge,
        }),
      });

      const data = await res.json();
      if (data.log) {
        setLogs((prev) => [data.log, ...prev]);
      }

      const updated: Appliance | undefined =
        data.updatedAppliance || data.result?.appliance || data.appliance;
      if (updated) {
        setAppliances((prev) => {
          const next = prev.map((a) => (a.id === updated.id ? updated : a));
          appliancesRef.current = next;
          return next;
        });
        setSelectedAppliance(updated);

        pushNotification({
          title: `${updated.name} turned ${updated.powerState}`,
          message: `Intent-Gated Actuation succeeded: ${updated.name} is now ${updated.powerState}.`,
          applianceId: updated.id,
          powerState: updated.powerState,
        });
      }

      if (data.calibratedProfile) {
        setSelectedProfile(data.calibratedProfile);
        setProfiles((prev) =>
          prev.map((p) =>
            p.id === data.calibratedProfile.id ? data.calibratedProfile : p
          )
        );
      }
    } catch (error) {
      console.error("Failed to record actuation:", error);
    }
  };

  const handleClearLogs = async () => {
    try {
      await fetch("/api/actuate", { method: "DELETE" });
      setLogs([]);
      setCalibrationEvents([]);
    } catch (error) {
      console.error("Failed to clear logs:", error);
    }
  };

  const fanAppliance = appliances.find((a) => a.id === "fan_table");
  const heaterAppliance = appliances.find((a) => a.id === "heater_radiant");
  const activeGestureBinding = getDefaultBindingForGesture(detectedGesture, gestureMappings);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Navigation & Profile Header */}
      <Header
        profiles={profiles}
        selectedProfile={selectedProfile}
        onSelectProfile={(prof) => setSelectedProfile(prof)}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        filterEnabled={filterEnabled}
        setFilterEnabled={setFilterEnabled}
        onOpenEnrolment={() => setIsEnrolmentOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 space-y-5">
        {/* Live Notification Banner & Quick High-Ampere / Fan Triggers */}
        <div className="bg-slate-900/95 border border-cyan-500/30 rounded-xl p-3.5 shadow-lg flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 flex-shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <div>
              {notifications.length > 0 ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-emerald-300">
                      {notifications[0].title}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      {notifications[0].timestamp}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 mt-0.5">{notifications[0].message}</p>
                </div>
              ) : (
                <div>
                  <span className="text-xs font-bold text-slate-100">
                    Dynamic Gesture → Appliance Bus Ready (High-Ampere Long-Hold Enabled)
                  </span>
                  <p className="text-xs text-slate-400">
                    Hold <strong>✊ FIST</strong> (2.5s) to toggle the <strong>2000W Space Heater</strong>, <strong>✋ OPEN_PALM</strong> (0.8s) for <strong>Fan</strong>, or customize any gesture binding below.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick 1-Click FIST -> Heater (2000W / 9.1A) Test Button */}
            <button
              type="button"
              onClick={() => triggerGestureActuation("FIST", "QUICK_GESTURE_BTN")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow ${
                heaterAppliance?.powerState === "ON"
                  ? "bg-rose-500 text-white hover:bg-rose-400"
                  : "bg-amber-500 text-slate-950 hover:bg-amber-400"
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              <span>
                ✊ FIST → Turn Heater {heaterAppliance?.powerState === "ON" ? "OFF" : "ON"} (9.1A)
              </span>
            </button>

            {/* Quick 1-Click OPEN_PALM -> Fan Test Button */}
            <button
              type="button"
              onClick={() => triggerGestureActuation("OPEN_PALM", "QUICK_GESTURE_BTN")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all shadow ${
                fanAppliance?.powerState === "ON"
                  ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                  : "bg-emerald-600 text-white hover:bg-emerald-500"
              }`}
            >
              <Fan
                className={`w-3.5 h-3.5 ${
                  fanAppliance?.powerState === "ON" ? "animate-spin" : ""
                }`}
              />
              <span>
                ✋ OPEN_PALM → Turn Fan {fanAppliance?.powerState === "ON" ? "OFF" : "ON"}
              </span>
            </button>

            {/* Customize Gestures Toggle */}
            <button
              type="button"
              onClick={() => setShowGestureCustomizer((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 ${
                showGestureCustomizer
                  ? "bg-cyan-500 text-slate-950 border-cyan-400"
                  : "bg-slate-800 hover:bg-slate-700 text-cyan-300 border-slate-700"
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>{showGestureCustomizer ? "Hide Customizer" : "Customize Gestures"}</span>
            </button>

            {/* Background User Observation Counter */}
            <button
              type="button"
              onClick={() => setActiveTab("LOGS")}
              className="px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-700 text-[11px] font-mono text-cyan-300 flex items-center gap-1.5"
              title="View background user observations & storage files"
            >
              <Database className="w-3.5 h-3.5 text-cyan-400" />
              <span>Bg Logs: {backgroundObsCount}</span>
            </button>
          </div>
        </div>

        {/* Live Sustained Hold Progress Bar (Shows dynamic long-hold for High-Ampere vs quick-hold for Low-Ampere) */}
        {activeGestureBinding && (
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <span className="text-lg">{activeGestureBinding.icon}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-cyan-300">
                    Active Gesture: {activeGestureBinding.gesture}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="font-bold text-slate-100">
                    {activeGestureBinding.defaultApplianceName}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      activeGestureBinding.isHighAmpere
                        ? "bg-rose-950 text-rose-300 border border-rose-800"
                        : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    }`}
                  >
                    {activeGestureBinding.isHighAmpere
                      ? `HIGH-AMPERE (${activeGestureBinding.amperageRating}) · ${(
                          activeGestureBinding.requiredHoldMs / 1000
                        ).toFixed(1)}s Long Hold`
                      : `LOW-AMPERE (${activeGestureBinding.amperageRating}) · ${(
                          activeGestureBinding.requiredHoldMs / 1000
                        ).toFixed(1)}s Quick Hold`}
                  </span>
                </div>
                <div className="w-full sm:w-96 bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800 mt-1.5">
                  <div
                    className={`h-full transition-all duration-100 ${
                      activeGestureBinding.isHighAmpere
                        ? "bg-gradient-to-r from-amber-500 to-rose-500"
                        : "bg-gradient-to-r from-cyan-500 to-emerald-400"
                    }`}
                    style={{ width: `${gestureHoldProgress}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-cyan-300">
                Hold: {(gestureHoldElapsedMs / 1000).toFixed(1)}s /{" "}
                {(activeGestureBinding.requiredHoldMs / 1000).toFixed(1)}s ({gestureHoldProgress}%)
              </span>
              <button
                type="button"
                onClick={() => setAutoGestureActuation((v) => !v)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono border ${
                  autoGestureActuation
                    ? "bg-emerald-950/70 border-emerald-600/60 text-emerald-300"
                    : "bg-slate-800 border-slate-700 text-slate-400"
                }`}
              >
                Auto-Hold: {autoGestureActuation ? "ON" : "OFF"}
              </button>
            </div>
          </div>
        )}

        {/* Dynamic User-Customizable Gesture-to-Appliance Studio */}
        {showGestureCustomizer && (
          <div className="bg-slate-900/95 border-2 border-cyan-500/40 rounded-xl p-4 shadow-2xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  Dynamic Gesture → Appliance Customizer & High-Ampere Hold Timer
                </h3>
                <p className="text-xs text-slate-400">
                  Assign any hand gesture to any appliance and customize how long the gesture must be held (e.g., <strong>✊ FIST</strong> for 2.5s on High-Ampere Heater or AC).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetMappings}
                  disabled={savingMappings}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveCustomMappings}
                  disabled={savingMappings}
                  className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 shadow-md"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingMappings ? "Saving..." : "Save Custom Mappings"}</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {gestureMappings.map((binding) => (
                <div
                  key={binding.gesture}
                  className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 ${
                    binding.isHighAmpere
                      ? "bg-rose-950/20 border-rose-500/30"
                      : "bg-slate-950/80 border-slate-800"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{binding.icon}</span>
                      <div>
                        <span className="text-xs font-mono font-bold text-cyan-300">
                          {binding.gesture}
                        </span>
                        <span className="text-[11px] text-slate-400 block">
                          {binding.label}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                        binding.isHighAmpere
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {binding.amperageRating}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    {/* Target Appliance Selector */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Target Appliance
                      </label>
                      <select
                        value={binding.defaultApplianceId}
                        onChange={(e) =>
                          handleUpdateGestureMapping(binding.gesture, {
                            defaultApplianceId: e.target.value,
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
                      >
                        {appliances.map((app) => (
                          <option key={app.id} value={app.id}>
                            {app.name} ({app.riskTier})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Action Selector */}
                    <div>
                      <label className="text-[10px] text-slate-400 block mb-1">
                        Command Action
                      </label>
                      <select
                        value={binding.command}
                        onChange={(e) =>
                          handleUpdateGestureMapping(binding.gesture, {
                            command: e.target.value,
                          })
                        }
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100"
                      >
                        <option value="TOGGLE_POWER">Toggle ON / OFF</option>
                        <option value="SET_POWER_ON">Turn ON Only</option>
                        <option value="SET_POWER_OFF">Turn OFF Only</option>
                        <option value="TOGGLE_FAN_POWER">Toggle Fan (Spd 2 / Off)</option>
                        <option value="CYCLE_FAN_SPEED">Cycle Fan Speed (1-4)</option>
                      </select>
                    </div>

                    {/* Hold Duration Slider */}
                    <div>
                      <label className="text-[10px] text-slate-400 flex items-center justify-between mb-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-cyan-400" />
                          Hold Time
                        </span>
                        <span className="font-mono text-cyan-300 font-bold">
                          {(binding.requiredHoldMs / 1000).toFixed(1)}s
                        </span>
                      </label>
                      <input
                        type="range"
                        min={500}
                        max={4000}
                        step={100}
                        value={binding.requiredHoldMs}
                        onChange={(e) =>
                          handleUpdateGestureMapping(binding.gesture, {
                            requiredHoldMs: Number(e.target.value),
                          })
                        }
                        className="w-full accent-cyan-400 cursor-pointer mt-1"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Default Gesture-to-Appliance Quick Trigger Strip (All 10 Gestures) */}
        <div className="bg-slate-900/75 border border-slate-800 rounded-xl p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              10 Dynamic Hand Gestures → Appliance Bindings (Hold in Camera or Click to Trigger)
            </span>
            <button
              type="button"
              onClick={() => setShowGestureCustomizer((v) => !v)}
              className="text-[11px] font-mono text-cyan-400 hover:underline"
            >
              {showGestureCustomizer ? "Close Gesture Customizer" : "⚙️ Customize Gesture Map & Hold Times"}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2">
            {gestureMappings.map((item: DefaultGestureApplianceBinding) => {
              const app = appliances.find((a) => a.id === item.defaultApplianceId);
              const isOn = app?.powerState === "ON";
              const isDetected = detectedGesture === item.gesture;

              return (
                <button
                  key={item.gesture}
                  type="button"
                  onClick={() => {
                    latestGestureRef.current = item.gesture;
                    setDetectedGesture(item.gesture);
                    gestureHoldStateRef.current = {
                      gesture: item.gesture,
                      elapsedMs: 0,
                      lastActuatedAtMs: Date.now(),
                      actuatedForCurrentHold: true,
                    };
                    triggerGestureActuation(item.gesture, "QUICK_GESTURE_BTN");
                  }}
                  className={`p-2 rounded-lg border text-left transition-all ${
                    isDetected
                      ? "bg-cyan-950/60 border-cyan-400 ring-1 ring-cyan-400/40"
                      : "bg-slate-950/80 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono font-bold text-cyan-300 truncate">
                      {item.icon} {item.gesture}
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1 py-0.5 rounded font-bold ${
                        isOn
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {app?.powerState || "OFF"}
                    </span>
                  </div>
                  <div className="text-[10px] font-medium text-slate-200 truncate mt-1">
                    {item.defaultApplianceName
                      .replace("Study ", "")
                      .replace("Living Room ", "")
                      .replace("Radiant Quartz ", "")
                      .replace("Smart ", "")}
                  </div>
                  <div className="text-[9px] font-mono text-slate-400 mt-0.5">
                    Hold {(item.requiredHoldMs / 1000).toFixed(1)}s · {item.amperageRating.split(" ")[0]}A
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* TAB 1: GESTURE CONTROLLER & CONNECTED LIVE HOUSE */}
        {activeTab === "CONTROLLER" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Camera Column: Expands to full 12 columns in Theater View, or 7 columns in split view */}
              <div
                className={`${
                  expandedCameraView ? "lg:col-span-12" : "lg:col-span-7"
                } space-y-5`}
              >
                <LiveCameraStream
                  user={selectedProfile}
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
                  onPersonalizeSuccess={(updatedUser) => {
                    setSelectedProfile(updatedUser);
                    setProfiles((prev) =>
                      prev.map((p) => (p.id === updatedUser.id ? updatedUser : p))
                    );
                  }}
                  expandedView={expandedCameraView}
                  onToggleExpandedView={() => setExpandedCameraView((v) => !v)}
                  onSyntheticGestureSelect={handleSyntheticGestureSelect}
                  onLiveHandFrame={setLiveHandFrame}
                />

                {/* Live Hand Morphology & 60s Enrolment Strip */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100">
                        Personalized AI Hand Model & Live Footage Enrolment
                      </h4>
                      <p className="text-[11px] text-slate-400 font-mono">
                        Palm: {(selectedProfile?.palmScale ?? 0.22).toFixed(2)} · Flex:{" "}
                        {(selectedProfile?.fingerFlexibility ?? 0.96).toFixed(2)} · Tremor:{" "}
                        {currentF0Hz.toFixed(1)}Hz ({currentAmpRms.toFixed(3)} RMS)
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setIsEnrolmentOpen(true)}
                      className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold transition-all shadow-md"
                    >
                      Record Live Footage & Train 60s AI Profile
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Side: Connected Interactive House Scene + Dwell Controller */}
              <div
                className={`${
                  expandedCameraView ? "lg:col-span-12" : "lg:col-span-5"
                } space-y-5`}
              >
                <LiveHouseScene
                  appliances={appliances}
                  selectedId={selectedAppliance?.id}
                  onSelect={(a) => setSelectedAppliance(a)}
                  onToggleAppliance={handleToggleAppliancePower}
                  onStepFanSpeed={handleCycleFanSpeed}
                  compact={!expandedCameraView}
                />

                <DwellRingController
                  selectedAppliance={selectedAppliance}
                  selectedProfile={selectedProfile}
                  liveIntentScore={liveIntentScore}
                  liveStabilityNorm={stabilityNorm}
                  livePosterior={posterior}
                  liveMargin={margin}
                  liveAttention={attention}
                  liveLighting={sceneQuality}
                  liveTremorAmp={currentAmpRms}
                  liveDetectedGesture={detectedGesture}
                  baselineMode={baselineMode}
                  onSetBaselineMode={setBaselineMode}
                  onActuateComplete={handleActuateComplete}
                  onDirectToggleAppliance={handleToggleAppliancePower}
                />
              </div>
            </div>

            {/* Embedded Quick Appliance Grid right below so users can also toggle any device without switching tabs */}
            <ApplianceCardGrid
              appliances={appliances}
              selectedAppliance={selectedAppliance}
              onSelectAppliance={(app) => setSelectedAppliance(app)}
              onTogglePower={handleToggleAppliancePower}
              onCycleFanSpeed={handleCycleFanSpeed}
            />
          </div>
        )}

        {/* TAB 2: APPLIANCES & DEFAULT GESTURE MAP */}
        {activeTab === "APPLIANCES" && (
          <div className="space-y-6">
            <LiveHouseScene
              appliances={appliances}
              selectedId={selectedAppliance?.id}
              onSelect={(a) => setSelectedAppliance(a)}
              onToggleAppliance={handleToggleAppliancePower}
              onStepFanSpeed={handleCycleFanSpeed}
            />
            <ApplianceCardGrid
              appliances={appliances}
              selectedAppliance={selectedAppliance}
              onSelectAppliance={(app) => setSelectedAppliance(app)}
              onTogglePower={handleToggleAppliancePower}
              onCycleFanSpeed={handleCycleFanSpeed}
            />
          </div>
        )}

        {/* TAB 3: ROOM-BY-ROOM SMART HOUSE SIMULATOR */}
        {activeTab === "SIMULATOR" && (
          <div className="space-y-6">
            <LiveHouseScene
              appliances={appliances}
              selectedId={selectedAppliance?.id}
              onSelect={(a) => setSelectedAppliance(a)}
              onToggleAppliance={handleToggleAppliancePower}
              onStepFanSpeed={handleCycleFanSpeed}
            />
            <SmartHouseSimulator
              appliances={appliances}
              selectedAppliance={selectedAppliance}
              onSelectAppliance={(app) => setSelectedAppliance(app)}
              onDirectUpdate={handleDirectApplianceUpdate}
              onNavigateToController={(app) => {
                setSelectedAppliance(app);
                setActiveTab("CONTROLLER");
              }}
            />
          </div>
        )}

        {/* TAB 4: USER DATA, STORAGE & AUDIT LOGS */}
        {activeTab === "LOGS" && (
          <AuditLogView
            logs={logs}
            onClearLogs={handleClearLogs}
            calibrationEvents={calibrationEvents}
          />
        )}

        {/* TAB 5: ADMINISTRATOR AI GESTURE TRAINER & DATASET STUDIO */}
        {activeTab === "ADMIN_TRAINER" && (
          <div className="space-y-6">
            <LiveCameraStream
              user={selectedProfile}
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
              onPersonalizeSuccess={(updatedUser) => {
                setSelectedProfile(updatedUser);
                setProfiles((prev) =>
                  prev.map((p) => (p.id === updatedUser.id ? updatedUser : p))
                );
              }}
              expandedView={false}
              onToggleExpandedView={() => setExpandedCameraView((v) => !v)}
              onSyntheticGestureSelect={handleSyntheticGestureSelect}
              onLiveHandFrame={setLiveHandFrame}
            />

            <AdminGestureTrainer
              user={selectedProfile}
              liveLandmarks={liveHandFrame?.landmarks ?? null}
              liveHandParams={liveHandFrame?.handParams ?? null}
              liveGesture={detectedGesture}
              liveConfidence={posterior}
              webcamActive={!!liveHandFrame?.webcamActive}
              sceneLuminance={sceneQuality}
              sceneContrast={0.22}
              sceneClutter={0.14}
              currentF0Hz={currentF0Hz}
              currentAmpRms={currentAmpRms}
              onModelUpdated={(updatedModel) => {
                pushNotification({
                  title: `Admin AI Model v${updatedModel.version} Updated`,
                  message: `Trained on ${updatedModel.totalSamplesTrained.toLocaleString()} samples (${updatedModel.negativeGraspSignatures.length} negative grasp guards).`,
                });
              }}
            />
          </div>
        )}
      </main>

      {/* 60-Second Live Camera Footage & AI Personalization Enrolment Modal */}
      <EnrolmentModal
        isOpen={isEnrolmentOpen}
        onClose={() => setIsEnrolmentOpen(false)}
        onProfileCreated={(newProfile) => {
          setProfiles((prev) => {
            const exists = prev.some((p) => p.id === newProfile.id);
            return exists
              ? prev.map((p) => (p.id === newProfile.id ? newProfile : p))
              : [...prev, newProfile];
          });
          setSelectedProfile(newProfile);
          pushNotification({
            title: `AI Model Trained & Saved: ${newProfile.name}`,
            message: `Saved live footage dataset & AI gesture model (f0=${newProfile.f0Hz}Hz, Palm=${newProfile.palmScale}, Dwell=${newProfile.adaptiveDwellFactor}x) to storage/.`,
          });
        }}
        liveTrajectoryY={liveTrajectoryY}
        liveGesture={detectedGesture}
        liveTremorHz={currentF0Hz}
        liveTremorAmp={currentAmpRms}
        liveStability={stabilityNorm}
      />

      {/* Footer Status Bar */}
      <footer className="mt-8 border-t border-slate-900 bg-slate-950/90 py-3 px-6 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Activity className="w-3.5 h-3.5 text-cyan-500" />
            <span>
              SteadyGate Unified Hub · Live Camera AI Enrolment · Dynamic Gesture-to-Appliance Mapper (`storage/` & `logs/`)
            </span>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Active Profile:{" "}
            <strong className="text-cyan-400">{selectedProfile?.name || "Loading..."}</strong> ·{" "}
            Heater (✊ FIST):{" "}
            <strong className="text-rose-400">{heaterAppliance?.powerState || "OFF"}</strong> ·{" "}
            Fan (✋ PALM):{" "}
            <strong className="text-emerald-400">
              {fanAppliance?.powerState === "ON"
                ? `ON (${fanAppliance.airRpm} RPM)`
                : "OFF"}
            </strong>
          </div>
        </div>
      </footer>
    </div>
  );
}
