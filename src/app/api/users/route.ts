import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    await seedDatabase();
    const list = await db.select().from(users);
    return NextResponse.json({ success: true, users: list });
  } catch (error) {
    console.error("GET /api/users error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      id,
      name,
      condition,
      f0Hz,
      amplitudeRms,
      notchBandwidthHz,
      attentionFloor,
      adaptiveDwellFactor,
      medicationPhase,
    } = body;

    if (!id || !name) {
      return NextResponse.json({ success: false, error: "id and name are required" }, { status: 400 });
    }

    const existing = await db.select().from(users).where(eq(users.id, id));

    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          name: name ?? existing[0].name,
          condition: condition ?? existing[0].condition,
          f0Hz: f0Hz !== undefined ? f0Hz : existing[0].f0Hz,
          amplitudeRms: amplitudeRms !== undefined ? amplitudeRms : existing[0].amplitudeRms,
          notchBandwidthHz:
            notchBandwidthHz !== undefined ? notchBandwidthHz : existing[0].notchBandwidthHz,
          attentionFloor:
            attentionFloor !== undefined ? attentionFloor : existing[0].attentionFloor,
          adaptiveDwellFactor:
            adaptiveDwellFactor !== undefined ? adaptiveDwellFactor : existing[0].adaptiveDwellFactor,
          medicationPhase:
            medicationPhase !== undefined ? medicationPhase : existing[0].medicationPhase,
          lastCalibratedAt: new Date(),
        })
        .where(eq(users.id, id));
    } else {
      await db.insert(users).values({
        id,
        name,
        condition: condition || "Enrolled User",
        f0Hz: f0Hz || 5.0,
        amplitudeRms: amplitudeRms || 0.045,
        notchBandwidthHz: notchBandwidthHz || 2.0,
        attentionFloor: attentionFloor || 0.60,
        adaptiveDwellFactor: adaptiveDwellFactor || 1.30,
        medicationPhase: medicationPhase || "Baseline",
      });
    }

    const updated = await db.select().from(users).where(eq(users.id, id));
    return NextResponse.json({ success: true, user: updated[0] });
  } catch (error) {
    console.error("POST /api/users error:", error);
    return NextResponse.json({ success: false, error: "Failed to upsert user" }, { status: 500 });
  }
}
