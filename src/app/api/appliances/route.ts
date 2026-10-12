import { NextResponse } from "next/server";
import { db } from "@/db";
import { appliances } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { eq } from "drizzle-orm";
import { fanTelemetry, acTelemetry, lampTelemetry, heaterTelemetry, geyserTelemetry, zeroPowerTelemetry } from "@/lib/iot-physics";

export async function GET() {
  try {
    await seedDatabase();
    const list = await db.select().from(appliances);
    return NextResponse.json({ success: true, appliances: list });
  } catch (error) {
    console.error("GET /api/appliances error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch appliances" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      powerState,
      targetValue,
      fanSpeed,
      temperature,
      brightness,
      airRpm,
      airflowCfm,
      activeWattage,
      adminOverride,
      reason,
    } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: "Missing appliance id" }, { status: 400 });
    }

    const existing = await db.select().from(appliances).where(eq(appliances.id, id));
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: "Appliance not found" }, { status: 404 });
    }

    const current = existing[0];

    // HazardSentinel / ChiefDebugger structural fix:
    // R2 devices cannot be forced ON via raw appliances API without admin override.
    if (
      current.riskTier === "R2" &&
      powerState === "ON" &&
      current.powerState !== "ON" &&
      !adminOverride
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "R2_REQUIRES_INTENT_GATE",
          message:
            "R2 hazard devices require SteadyGate intent gate + two-gesture handshake. Pass adminOverride:true with reason only from Admin console.",
        },
        { status: 403 }
      );
    }

    if (current.riskTier === "R2" && powerState === "ON" && adminOverride && !reason) {
      return NextResponse.json(
        { success: false, error: "adminOverride requires reason string" },
        { status: 400 }
      );
    }

    const updates: Partial<typeof appliances.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Unified physics via iot-physics.ts
    if (fanSpeed !== undefined || (powerState !== undefined && id.includes("fan"))) {
      const speed =
        fanSpeed !== undefined
          ? fanSpeed
          : powerState === "OFF"
          ? 0
          : powerState === "ON"
          ? Math.max(1, current.fanSpeed || 2)
          : current.fanSpeed;
      const phys = fanTelemetry(speed);
      updates.fanSpeed = phys.fanSpeed;
      updates.powerState = phys.powerState;
      updates.airRpm = phys.airRpm;
      updates.airflowCfm = phys.airflowCfm;
      updates.activeWattage = phys.activeWattage;
      updates.targetValue = phys.targetValue;
    } else if (temperature !== undefined || (powerState !== undefined && id.includes("ac"))) {
      const on =
        powerState !== undefined ? powerState === "ON" : current.powerState === "ON";
      const temp = temperature !== undefined ? temperature : current.temperature || 22;
      const phys = acTelemetry(on, temp);
      updates.powerState = phys.powerState;
      updates.temperature = phys.temperature;
      updates.targetValue = phys.targetValue;
      updates.activeWattage = phys.activeWattage;
      updates.fanSpeed = phys.fanSpeed;
      updates.airRpm = phys.airRpm;
      updates.airflowCfm = phys.airflowCfm;
    } else if (powerState !== undefined && id.includes("lamp")) {
      const phys = lampTelemetry(powerState === "ON", brightness ?? current.brightness ?? 80);
      updates.powerState = phys.powerState;
      updates.brightness = phys.brightness;
      updates.activeWattage = phys.activeWattage;
      updates.targetValue = phys.targetValue;
    } else if (powerState !== undefined && id.includes("heater")) {
      const phys = heaterTelemetry(powerState === "ON");
      updates.powerState = phys.powerState;
      updates.activeWattage = phys.activeWattage;
      updates.targetValue = phys.targetValue;
    } else if (powerState !== undefined && id.includes("geyser")) {
      const phys = geyserTelemetry(powerState === "ON", temperature ?? current.temperature ?? 65);
      updates.powerState = phys.powerState;
      updates.temperature = phys.temperature;
      updates.activeWattage = phys.activeWattage;
      updates.targetValue = phys.targetValue;
    } else {
      if (powerState !== undefined) {
        updates.powerState = powerState;
        if (powerState === "OFF") {
          Object.assign(updates, zeroPowerTelemetry());
          if (id.includes("lamp")) updates.brightness = 0;
        }
      }
      if (targetValue !== undefined) updates.targetValue = targetValue;
      if (brightness !== undefined) updates.brightness = brightness;
      if (airRpm !== undefined) updates.airRpm = airRpm;
      if (airflowCfm !== undefined) updates.airflowCfm = airflowCfm;
      if (activeWattage !== undefined) updates.activeWattage = activeWattage;
      if (temperature !== undefined) updates.temperature = temperature;
    }

    await db.update(appliances).set(updates).where(eq(appliances.id, id));

    const updated = await db.select().from(appliances).where(eq(appliances.id, id));
    return NextResponse.json({
      success: true,
      appliance: updated[0],
      adminOverride: !!adminOverride,
      reason: reason || null,
    });
  } catch (error) {
    console.error("POST /api/appliances error:", error);
    return NextResponse.json({ success: false, error: "Failed to update appliance" }, { status: 500 });
  }
}
