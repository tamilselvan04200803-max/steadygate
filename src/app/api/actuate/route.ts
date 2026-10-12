import { NextResponse } from "next/server";
import { db } from "@/db";
import { appliances, users, actuationLogs, calibrationEvents } from "@/db/schema";
import { evaluateIntentGate } from "@/lib/steady-gate";
import { eq } from "drizzle-orm";
import { BaselineMode, UserProfile, Appliance } from "@/lib/types";
import {
  fanTelemetry,
  acTelemetry,
  lampTelemetry,
  heaterTelemetry,
  geyserTelemetry,
  zeroPowerTelemetry,
} from "@/lib/iot-physics";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      applianceId,
      userId,
      gesture = "OPEN_PALM",
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
      dwellTimeHeldMs = 1200,
      baselineMode = "STEADYGATE",
      isSecondaryHandshakeGesture = false,
      wasReAttempt = false,
    } = body;

    if (!applianceId || !userId) {
      return NextResponse.json(
        { success: false, error: "applianceId and userId are required" },
        { status: 400 }
      );
    }

    const applianceRecords = await db.select().from(appliances).where(eq(appliances.id, applianceId));
    if (applianceRecords.length === 0) {
      return NextResponse.json({ success: false, error: "Appliance not found" }, { status: 404 });
    }
    const currentAppliance = applianceRecords[0] as unknown as Appliance;

    const userRecords = await db.select().from(users).where(eq(users.id, userId));
    if (userRecords.length === 0) {
      return NextResponse.json({ success: false, error: "User profile not found" }, { status: 404 });
    }
    const currentUser = userRecords[0] as unknown as UserProfile;

    // Safety: baselines cannot actuate R2 (HazardSentinel structural fix)
    const mode = (baselineMode as BaselineMode) || "STEADYGATE";
    if (
      currentAppliance.riskTier === "R2" &&
      mode !== "STEADYGATE" &&
      !isSecondaryHandshakeGesture
    ) {
      const logId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      await db.insert(actuationLogs).values({
        id: logId,
        applianceId,
        applianceName: currentAppliance.name,
        userId,
        userName: currentUser.name,
        gesture,
        targetCommand: "BLOCKED_BASELINE_R2",
        riskTier: currentAppliance.riskTier,
        intentScore: 0,
        posterior,
        margin: Math.max(0, posterior - top2Posterior),
        attention,
        stabilityRaw,
        stabilityNorm,
        sceneQuality,
        contextPrior,
        dwellTimeMs: dwellTimeHeldMs,
        dwellRequiredMs: 0,
        baselineMode: mode,
        status: "REJECTED",
        rejectCode: "HANDSHAKE_TIMEOUT",
        wasReAttempt: !!wasReAttempt,
        calibratedNudge: false,
      });
      return NextResponse.json({
        success: true,
        logId,
        decision: {
          status: "REJECTED",
          rejectCode: "HANDSHAKE_TIMEOUT",
          rejectExplanation:
            "Safety policy: baseline modes B0/B1/B2 cannot actuate R2 hazard devices. Switch to SteadyGate.",
          intentScore: 0,
          intentComponents: {
            posterior,
            margin: Math.max(0, posterior - top2Posterior),
            attention,
            stabilityRaw,
            stabilityNorm,
            sceneQuality,
            contextPrior,
            fusedIntent: 0,
          },
          dwellRequiredMs: 0,
          dwellCompletedMs: dwellTimeHeldMs,
          dwellProgressPct: 0,
          isAchieved: false,
          requiresSecondaryConfirmation: true,
          isHandshakeReady: false,
        },
        appliance: currentAppliance,
      });
    }

    const decision = evaluateIntentGate({
      posterior,
      top2Posterior,
      margin: Math.max(0, posterior - top2Posterior),
      attention,
      stabilityRaw,
      stabilityNorm,
      sceneQuality,
      contextPrior,
      dwellTimeHeldMs,
      user: currentUser,
      appliance: currentAppliance,
      baselineMode: mode,
      isSecondaryHandshakeGesture,
    });

    let updatedAppliance = currentAppliance;
    let didNudge = false;

    if (decision.status === "ACTUATED") {
      const updates: Partial<typeof appliances.$inferInsert> = {
        updatedAt: new Date(),
      };

      if (gesture === "FIST") {
        updates.powerState = "OFF";
        Object.assign(updates, zeroPowerTelemetry());
        if (currentAppliance.id.includes("lamp")) updates.brightness = 0;
        // FIST on deadbolt => LOCK (ON)
        if (currentAppliance.id.includes("deadbolt")) {
          updates.powerState = "ON";
          updates.activeWattage = 8;
        }
      } else if (
        gesture === "VICTORY" &&
        (currentAppliance.id.includes("fan") || currentAppliance.category === "Climate") &&
        !currentAppliance.id.includes("ac")
      ) {
        const nextSpeed = ((currentAppliance.fanSpeed || 0) + 1) % 5;
        const phys = fanTelemetry(nextSpeed);
        Object.assign(updates, phys);
      } else if (
        gesture === "POINTING_UP" &&
        (currentAppliance.id.includes("ac") || currentAppliance.name.toLowerCase().includes("ac"))
      ) {
        if (currentAppliance.powerState === "OFF") {
          Object.assign(updates, acTelemetry(true, 22));
        } else {
          const temps = [24, 22, 20, 18];
          const currIdx = temps.indexOf(Math.round(currentAppliance.temperature || 22));
          const nextTemp = temps[(currIdx + 1) % temps.length];
          Object.assign(updates, acTelemetry(true, nextTemp));
        }
      } else if (gesture === "VICTORY" && !currentAppliance.id.includes("fan")) {
        // VisionGuard fix: VICTORY on non-fan should not silently toggle unrelated devices
        // Fall through as no-op power keep + still log actuated intent for fan routing UX
        // Actually reject-like: keep state unchanged but mark command as routed notice
        updates.powerState = currentAppliance.powerState;
      } else {
        const newPowerState =
          targetPowerState || (currentAppliance.powerState === "ON" ? "OFF" : "ON");

        if (currentAppliance.id.includes("fan")) {
          const speed = newPowerState === "ON" ? fanSpeed ?? 2 : 0;
          Object.assign(updates, fanTelemetry(speed));
        } else if (currentAppliance.id.includes("ac")) {
          Object.assign(
            updates,
            acTelemetry(newPowerState === "ON", temperature ?? currentAppliance.temperature ?? 22)
          );
        } else if (currentAppliance.id.includes("lamp")) {
          Object.assign(updates, lampTelemetry(newPowerState === "ON", 80));
        } else if (currentAppliance.id.includes("heater")) {
          Object.assign(updates, heaterTelemetry(newPowerState === "ON"));
        } else if (currentAppliance.id.includes("geyser")) {
          Object.assign(updates, geyserTelemetry(newPowerState === "ON", 65));
        } else {
          updates.powerState = newPowerState;
          if (newPowerState === "OFF") Object.assign(updates, zeroPowerTelemetry());
          if (newPowerState === "ON" && currentAppliance.id.includes("deadbolt")) {
            updates.activeWattage = 8;
          }
        }

        if (targetValue !== undefined) updates.targetValue = targetValue;
      }

      await db.update(appliances).set(updates).where(eq(appliances.id, applianceId));
      const updated = await db.select().from(appliances).where(eq(appliances.id, applianceId));
      updatedAppliance = updated[0] as unknown as Appliance;

      if (wasReAttempt) {
        const oldAmp = currentUser.amplitudeRms;
        // Cap cumulative nudge: max 1.2x would need enrolment amp — soft cap at 0.12 abs
        const newAmp = Math.min(0.12, Math.round(oldAmp * 1.04 * 1000) / 1000);
        await db
          .update(users)
          .set({ amplitudeRms: newAmp, lastCalibratedAt: new Date() })
          .where(eq(users.id, userId));

        await db.insert(calibrationEvents).values({
          id: `nudge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          userId,
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
      decision.status === "ACTUATED"
        ? `SET power=${updatedAppliance.powerState}, target=${updatedAppliance.targetValue}${updatedAppliance.unit}, fanSpeed=${updatedAppliance.fanSpeed}, temp=${updatedAppliance.temperature}°C`
        : decision.status === "HANDSHAKE_PENDING"
        ? `ARM_R2_PENDING (Awaiting secondary confirmation)`
        : `PROPOSED power=${currentAppliance.powerState === "ON" ? "OFF" : "ON"}`;

    const logId = `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    await db.insert(actuationLogs).values({
      id: logId,
      applianceId,
      applianceName: currentAppliance.name,
      userId,
      userName: currentUser.name,
      gesture: isSecondaryHandshakeGesture ? `${gesture} (Secondary Handshake)` : gesture,
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
      dwellTimeMs: dwellTimeHeldMs,
      dwellRequiredMs: decision.dwellRequiredMs,
      baselineMode: mode,
      status: decision.status,
      rejectCode: decision.rejectCode,
      wasReAttempt: !!wasReAttempt,
      calibratedNudge: didNudge,
    });

    const mqttTopic =
      currentAppliance.mqttTopic ||
      `home/${currentAppliance.location.toLowerCase()}/${currentAppliance.id}`;

    return NextResponse.json({
      success: true,
      logId,
      decision,
      appliance: updatedAppliance,
      calibratedNudge: didNudge,
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
        roundTripMs: 14 + Math.floor(Math.random() * 8),
      },
    });
  } catch (error) {
    console.error("POST /api/actuate error:", error);
    return NextResponse.json({ success: false, error: "Actuation failed" }, { status: 500 });
  }
}
