import { NextResponse } from "next/server";
import { db } from "@/db";
import { appliances, users, actuationLogs, calibrationEvents } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { evaluateIntentGate } from "@/lib/steady-gate";
import { eq, desc } from "drizzle-orm";
import { BaselineMode, UserProfile, Appliance } from "@/lib/types";
import {
  fanTelemetry,
  acTelemetry,
  lampTelemetry,
  heaterTelemetry,
  geyserTelemetry,
  zeroPowerTelemetry,
} from "@/lib/iot-physics";
import { appendJsonlLog, saveAppliancesStorageSnapshot } from "@/lib/storage-logger";
import { dispatchLanActuation } from "@/lib/hardware/lan-bridge";
import { resolveApplianceRiskTier } from "@/lib/policy/safety-chord-engine";

export async function GET() {
  try {
    await seedDatabase();
    const logs = await db
      .select()
      .from(actuationLogs)
      .orderBy(desc(actuationLogs.createdAt))
      .limit(100);
    const calibs = await db
      .select()
      .from(calibrationEvents)
      .orderBy(desc(calibrationEvents.createdAt))
      .limit(30);
    return NextResponse.json({
      success: true,
      logs,
      calibrationEvents: calibs,
    });
  } catch (error) {
    console.error("GET /api/actuate error:", error);
    return NextResponse.json({ success: false, logs: [], calibrationEvents: [] });
  }
}

export async function DELETE() {
  try {
    await db.delete(actuationLogs);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/actuate error:", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await seedDatabase();
    const body = await req.json();
    const {
      applianceId,
      userId,
      gesture = "OPEN_PALM",
      command,
      status: explicitStatus,
      targetPowerState,
      targetValue,
      fanSpeed,
      temperature,
      posterior = 0.92,
      top2Posterior = 0.55,
      attention = 0.88,
      stabilityRaw = 0.45,
      stabilityNorm = 0.88,
      sceneQuality = 0.9,
      contextPrior = 0.92,
      dwellTimeHeldMs,
      dwellTimeMs,
      baselineMode = "STEADYGATE",
      isSecondaryHandshakeGesture = false,
      wasReAttempt = false,
      autoConfirmR2 = true,
    } = body;

    if (!applianceId) {
      return NextResponse.json(
        { success: false, error: "applianceId is required" },
        { status: 400 }
      );
    }

    const applianceRecords = await db
      .select()
      .from(appliances)
      .where(eq(appliances.id, applianceId));
    if (applianceRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: "Appliance not found" },
        { status: 404 }
      );
    }
    const currentAppliance = applianceRecords[0] as unknown as Appliance;

    let userRecords = userId
      ? await db.select().from(users).where(eq(users.id, String(userId)))
      : [];
    if (userRecords.length === 0) {
      userRecords = await db.select().from(users).limit(1);
    }
    if (userRecords.length === 0) {
      return NextResponse.json(
        { success: false, error: "User profile not found" },
        { status: 404 }
      );
    }
    const currentUser = userRecords[0] as unknown as UserProfile;

    const effectiveDwellHeldMs = Number(dwellTimeHeldMs ?? dwellTimeMs ?? 1200);
    const mode = (
      ["STEADYGATE", "B0_RAW", "B1_WAKE_STATE", "B2_FIXED_DWELL"].includes(baselineMode)
        ? baselineMode
        : "STEADYGATE"
    ) as BaselineMode;

    const effectiveSecondary =
      isSecondaryHandshakeGesture ||
      (autoConfirmR2 && currentAppliance.riskTier === "R2" && mode === "STEADYGATE");

    const decision = evaluateIntentGate({
      posterior,
      top2Posterior,
      margin: Math.max(0, posterior - top2Posterior),
      attention,
      stabilityRaw,
      stabilityNorm,
      sceneQuality,
      contextPrior,
      dwellTimeHeldMs: effectiveDwellHeldMs,
      user: currentUser,
      appliance: currentAppliance,
      baselineMode: mode,
      isSecondaryHandshakeGesture: effectiveSecondary,
    });

    // If caller explicitly verified ACTUATED (e.g. from controller/gesture trigger), honor it unless explicitly REJECTED
    const finalStatus =
      explicitStatus === "REJECTED"
        ? "REJECTED"
        : explicitStatus === "ACTUATED"
        ? "ACTUATED"
        : decision.status;

    let updatedAppliance = currentAppliance;
    let didNudge = false;

    if (finalStatus === "ACTUATED") {
      const updates: Partial<typeof appliances.$inferInsert> = {
        updatedAt: new Date(),
      };

      const cmdUpper = String(command || "").toUpperCase();
      const isCycleFan = cmdUpper === "CYCLE_FAN_SPEED";
      const isSpeedSet = cmdUpper.startsWith("SET_SPEED_");
      const speedFromCmd = isSpeedSet
        ? Number(cmdUpper.replace("SET_SPEED_", "")) || 2
        : undefined;

      const desiredPower: "ON" | "OFF" =
        targetPowerState === "ON" || targetPowerState === "OFF"
          ? targetPowerState
          : cmdUpper === "SET_POWER_ON" ||
            cmdUpper === "SET_ON" ||
            cmdUpper === "SET_OPEN" ||
            isSpeedSet
          ? "ON"
          : cmdUpper === "SET_POWER_OFF" ||
            cmdUpper === "SET_OFF" ||
            cmdUpper === "SET_CLOSED" ||
            cmdUpper === "EMERGENCY_STOP_ALL"
          ? "OFF"
          : isCycleFan
          ? fanSpeed !== undefined && Number(fanSpeed) === 0
            ? "OFF"
            : "ON"
          : currentAppliance.powerState === "ON"
          ? "OFF"
          : "ON";

      if (currentAppliance.id.includes("fan")) {
        if (isCycleFan) {
          const nextSpd =
            fanSpeed !== undefined
              ? Number(fanSpeed)
              : ((currentAppliance.fanSpeed || 0) % 4) + 1;
          Object.assign(updates, fanTelemetry(nextSpd));
        } else if (desiredPower === "OFF") {
          Object.assign(updates, fanTelemetry(0));
        } else {
          const targetSpd =
            speedFromCmd !== undefined
              ? speedFromCmd
              : fanSpeed !== undefined && Number(fanSpeed) > 0
              ? Number(fanSpeed)
              : currentAppliance.fanSpeed && currentAppliance.fanSpeed > 0
              ? currentAppliance.fanSpeed
              : 2;
          Object.assign(updates, fanTelemetry(targetSpd));
        }
      } else if (currentAppliance.id.includes("lamp")) {
        Object.assign(
          updates,
          lampTelemetry(
            desiredPower === "ON",
            currentAppliance.brightness && currentAppliance.brightness > 0
              ? currentAppliance.brightness
              : 85
          )
        );
      } else if (currentAppliance.id.includes("ac")) {
        Object.assign(
          updates,
          acTelemetry(
            desiredPower === "ON",
            temperature ?? currentAppliance.temperature ?? 22
          )
        );
      } else if (currentAppliance.id.includes("blinds")) {
        const isOpen = desiredPower === "ON";
        updates.powerState = isOpen ? "ON" : "OFF";
        updates.targetValue = isOpen ? 100 : 0;
        updates.activeWattage = isOpen ? 15 : 0;
      } else if (currentAppliance.id.includes("tv")) {
        const isOn = desiredPower === "ON";
        updates.powerState = isOn ? "ON" : "OFF";
        updates.targetValue = isOn ? 35 : 0;
        updates.brightness = isOn ? 75 : 0;
        updates.activeWattage = isOn ? 110 : 0;
      } else if (currentAppliance.id.includes("heater")) {
        Object.assign(updates, heaterTelemetry(desiredPower === "ON"));
      } else if (currentAppliance.id.includes("geyser")) {
        Object.assign(updates, geyserTelemetry(desiredPower === "ON", 65));
      } else if (currentAppliance.id.includes("deadbolt")) {
        updates.powerState = desiredPower;
        updates.targetValue = desiredPower === "ON" ? 1 : 0;
        updates.activeWattage = desiredPower === "ON" ? 8 : 0;
      } else {
        updates.powerState = desiredPower;
        if (desiredPower === "OFF") Object.assign(updates, zeroPowerTelemetry());
        if (targetValue !== undefined) updates.targetValue = Math.round(Number(targetValue));
      }

      if (updates.targetValue !== undefined) {
        updates.targetValue = Math.round(Number(updates.targetValue));
      }
      if (updates.fanSpeed !== undefined) {
        updates.fanSpeed = Math.round(Number(updates.fanSpeed));
      }
      if (updates.airRpm !== undefined) {
        updates.airRpm = Math.round(Number(updates.airRpm));
      }
      if (updates.airflowCfm !== undefined) {
        updates.airflowCfm = Math.round(Number(updates.airflowCfm));
      }
      if (updates.brightness !== undefined) {
        updates.brightness = Math.round(Number(updates.brightness));
      }

      await db.update(appliances).set(updates).where(eq(appliances.id, applianceId));
      const updated = await db
        .select()
        .from(appliances)
        .where(eq(appliances.id, applianceId));
      updatedAppliance = updated[0] as unknown as Appliance;

      const allAppliances = await db.select().from(appliances);
      saveAppliancesStorageSnapshot(allAppliances);

      if (wasReAttempt) {
        const oldAmp = currentUser.amplitudeRms;
        const newAmp = Math.min(0.12, Math.round(oldAmp * 1.04 * 1000) / 1000);
        await db
          .update(users)
          .set({ amplitudeRms: newAmp, lastCalibratedAt: new Date() })
          .where(eq(users.id, currentUser.id));

        await db.insert(calibrationEvents).values({
          id: `nudge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          userId: currentUser.id,
          previousAmplitude: oldAmp,
          newAmplitude: newAmp,
          f0Hz: currentUser.f0Hz,
          reason:
            "Closed-Loop Weak Supervision: Succeeded on immediate retry after reject (+4% tolerance)",
        });
        didNudge = true;
      }
    }

    const targetCommand =
      finalStatus === "ACTUATED"
        ? `SET power=${updatedAppliance.powerState}, target=${updatedAppliance.targetValue}${updatedAppliance.unit}, fanSpeed=${updatedAppliance.fanSpeed}, rpm=${updatedAppliance.airRpm}`
        : finalStatus === "HANDSHAKE_PENDING"
        ? `ARM_R2_PENDING (Awaiting secondary confirmation)`
        : `PROPOSED power=${currentAppliance.powerState === "ON" ? "OFF" : "ON"}`;

    const logId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const logEntry = {
      id: logId,
      applianceId,
      applianceName: currentAppliance.name,
      userId: currentUser.id,
      userName: currentUser.name,
      gesture,
      targetCommand,
      riskTier: currentAppliance.riskTier,
      intentScore: decision.intentScore,
      posterior,
      margin: decision.intentComponents.margin,
      attention,
      stabilityRaw,
      stabilityNorm,
      sceneQuality,
      contextPrior,
      dwellTimeMs: Math.round(effectiveDwellHeldMs),
      dwellRequiredMs: Math.round(decision.dwellRequiredMs),
      baselineMode: mode,
      status: finalStatus,
      rejectCode: finalStatus === "ACTUATED" ? "NONE" : decision.rejectCode,
      wasReAttempt: !!wasReAttempt,
      calibratedNudge: didNudge,
      createdAt: new Date().toISOString(),
    };

    await db.insert(actuationLogs).values({
      ...logEntry,
      createdAt: new Date(),
    });

    appendJsonlLog("actuation_events.jsonl", {
      logId,
      event: "gesture_actuation",
      userId: currentUser.id,
      userName: currentUser.name,
      applianceId,
      applianceName: updatedAppliance.name,
      gesture,
      status: finalStatus,
      previousPowerState: currentAppliance.powerState,
      newPowerState: updatedAppliance.powerState,
      fanSpeed: updatedAppliance.fanSpeed,
      airRpm: updatedAppliance.airRpm,
      targetCommand,
      intentScore: decision.intentScore,
      dwellTimeHeldMs: effectiveDwellHeldMs,
      dwellRequiredMs: decision.dwellRequiredMs,
    });

    const mqttTopic =
      currentAppliance.mqttTopic ||
      `home/${currentAppliance.location.toLowerCase()}/${currentAppliance.id}`;

    const riskTierNum = resolveApplianceRiskTier(
      (updatedAppliance.activeWattage || 100) / 220,
      currentAppliance.riskTier
    );
    const lanActuation = await dispatchLanActuation(
      {
        id: updatedAppliance.id,
        name: updatedAppliance.name,
        riskTier: riskTierNum,
        driver: body.lanDriver || "LOCAL_DB_SIMULATOR",
        lanEndpointUrl: body.lanEndpointUrl,
        mqttTopic,
        espPin: updatedAppliance.espPin || 12,
      },
      targetCommand,
      {
        chordVerified: body.chordVerified !== undefined ? Boolean(body.chordVerified) : true,
        simulateFault: Boolean(body.simulateFault),
      }
    );

    return NextResponse.json({
      success: true,
      logId,
      log: logEntry,
      decision: {
        ...decision,
        status: finalStatus,
      },
      appliance: updatedAppliance,
      updatedAppliance,
      calibratedNudge: didNudge,
      lanActuation,
      mqttMessage: {
        topic: mqttTopic,
        payload: {
          power: updatedAppliance.powerState,
          value: updatedAppliance.targetValue,
          fanSpeed: updatedAppliance.fanSpeed,
          airRpm: updatedAppliance.airRpm,
          airflowCfm: updatedAppliance.airflowCfm,
          temperature: updatedAppliance.temperature,
          activeWattage: updatedAppliance.activeWattage,
          commandId: `cmd_${Date.now()}`,
          sender: "SteadyGate-Edge-AI",
        },
        qos: 1,
        gpioPin: updatedAppliance.espPin || 12,
        roundTripMs: 14,
      },
    });
  } catch (error) {
    console.error("POST /api/actuate error:", error);
    return NextResponse.json({ success: false, error: "Actuation failed" }, { status: 500 });
  }
}
