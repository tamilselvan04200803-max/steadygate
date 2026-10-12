import { NextResponse } from "next/server";
import { db } from "@/db";
import { runtimeTelemetry } from "@/db/schema";
import { desc, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId = String(body.sessionId || "anon").slice(0, 64);
    const source = String(body.source || "vision").slice(0, 16);
    const payload = JSON.stringify(body.payload ?? {}).slice(0, 60000);
    const id = `tel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await db.insert(runtimeTelemetry).values({ id, sessionId, source, payload });

    // Directives: backend can steer the client (agent auto-remediation channel)
    const p = body.payload || {};
    const directives: Record<string, unknown> = {};
    const loaderEvents: Array<{ stage: string; ok: boolean }> = p.loaderEvents || [];
    const gpuFailed = loaderEvents.some((e) => e.stage.includes("_GPU") && !e.ok);
    if (gpuFailed && p.delegate !== "CPU") directives.preferDelegate = "CPU";
    if (p.fps && p.fps < 10 && p.delegate === "GPU") directives.preferDelegate = "CPU";
    if (p.scene && p.scene.luminance < 0.2) directives.coachLighting = true;

    return NextResponse.json({ success: true, id, directives });
  } catch (error) {
    console.error("POST /api/telemetry", error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export async function GET() {
  try {
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const rows = await db
      .select()
      .from(runtimeTelemetry)
      .where(gt(runtimeTelemetry.createdAt, since))
      .orderBy(desc(runtimeTelemetry.createdAt))
      .limit(60);
    return NextResponse.json({
      success: true,
      telemetry: rows.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        source: r.source,
        createdAt: r.createdAt,
        payload: safeParse(r.payload),
      })),
    });
  } catch (error) {
    console.error("GET /api/telemetry", error);
    return NextResponse.json({ success: false, telemetry: [] }, { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
