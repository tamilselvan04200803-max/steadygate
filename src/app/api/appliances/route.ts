import { NextResponse } from "next/server";
import { db } from "@/db";
import { appliances } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { eq } from "drizzle-orm";
import {
  fanTelemetry,
  acTelemetry,
  lampTelemetry,
  heaterTelemetry,
  geyserTelemetry,
  zeroPowerTelemetry,
} from "@/lib/iot-physics";
import { appendJsonlLog, saveAppliancesStorageSnapshot } from "@/lib/storage-logger";

export async function GET() {
  try {
    await seedDatabase();
    const list = await db.select().from(appliances);
    saveAppliancesStorageSnapshot(list);
    return NextResponse.json({ success: true, appliances: list });
  } catch (error) {
    console.error("GET /api/appliances error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch appliances" },
      { status: 500 }
    );
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
      triggerSource = "dashboard_control",
    } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing appliance id" },
        { status: 400 }
      );
    }

    await seedDatabase();
    const existing = await db.select().from(appliances).where(eq(appliances.id, id));
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: "Appliance not found" },
        { status: 404 }
      );
    }

    const current = existing[0];
    const updates: Partial<typeof appliances.$inferInsert> = {
      updatedAt: new Date(),
    };

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
    } else if ((powerState !== undefined || brightness !== undefined) && id.includes("lamp")) {
      const on =
        powerState !== undefined
          ? powerState === "ON"
          : brightness !== undefined
          ? Number(brightness) > 0
          : current.powerState === "ON";
      const targetBright =
        brightness !== undefined
          ? Number(brightness)
          : current.brightness > 0
          ? current.brightness
          : 80;
      const phys = lampTelemetry(on, on ? Math.max(5, targetBright) : 0);
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
    } else if (powerState !== undefined && id.includes("blinds")) {
      const isOpen = powerState === "ON";
      updates.powerState = isOpen ? "ON" : "OFF";
      updates.targetValue = isOpen ? 100 : 0;
      updates.activeWattage = isOpen ? 15 : 0;
    } else if (powerState !== undefined && id.includes("tv")) {
      const isOn = powerState === "ON";
      updates.powerState = isOn ? "ON" : "OFF";
      updates.targetValue = isOn ? (current.targetValue || 35) : 0;
      updates.brightness = isOn ? 75 : 0;
      updates.activeWattage = isOn ? 110 : 0;
    } else {
      if (powerState !== undefined) {
        updates.powerState = powerState;
        if (powerState === "OFF") {
          Object.assign(updates, zeroPowerTelemetry());
          if (id.includes("lamp")) updates.brightness = 0;
        } else if (powerState === "ON" && id.includes("deadbolt")) {
          updates.activeWattage = 8;
          updates.targetValue = 1;
        }
      }
      if (targetValue !== undefined) updates.targetValue = Math.round(Number(targetValue));
      if (brightness !== undefined) updates.brightness = Math.round(Number(brightness));
      if (airRpm !== undefined) updates.airRpm = Math.round(Number(airRpm));
      if (airflowCfm !== undefined) updates.airflowCfm = Math.round(Number(airflowCfm));
      if (activeWattage !== undefined) updates.activeWattage = Number(activeWattage);
      if (temperature !== undefined) updates.temperature = Number(temperature);
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

    await db.update(appliances).set(updates).where(eq(appliances.id, id));

    const updated = await db.select().from(appliances).where(eq(appliances.id, id));
    const allAppliances = await db.select().from(appliances);
    saveAppliancesStorageSnapshot(allAppliances);

    appendJsonlLog("actuation_events.jsonl", {
      event: "appliance_state_updated",
      triggerSource,
      applianceId: id,
      applianceName: updated[0].name,
      previousPowerState: current.powerState,
      newPowerState: updated[0].powerState,
      fanSpeed: updated[0].fanSpeed,
      airRpm: updated[0].airRpm,
      temperature: updated[0].temperature,
      brightness: updated[0].brightness,
      activeWattage: updated[0].activeWattage,
      reason: reason || "Direct dashboard / gesture control",
    });

    return NextResponse.json({
      success: true,
      appliance: updated[0],
      appliances: allAppliances,
      adminOverride: !!adminOverride,
      reason: reason || null,
    });
  } catch (error) {
    console.error("POST /api/appliances error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update appliance" },
      { status: 500 }
    );
  }
}
