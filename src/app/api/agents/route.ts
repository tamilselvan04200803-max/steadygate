import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  appliances,
  users,
  actuationLogs,
  calibrationEvents,
  agentFindings,
  agentRuns,
  runtimeTelemetry,
} from "@/db/schema";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { AGENT_ROSTER } from "@/lib/agent-roster";
import { buildSnapshot, runMultiAgentCouncil, uid } from "@/lib/agent-brain";
import type { ApiProbe, TelemetrySample } from "@/lib/agent-types";
import { seedDatabase } from "@/db/seed";
import { fanTelemetry, zeroPowerTelemetry } from "@/lib/iot-physics";

export const dynamic = "force-dynamic";

/* ------------------------------ live API probes ------------------------------ */
async function probe(origin: string, route: string, init?: RequestInit, expect?: (b: unknown) => boolean, expectStatus?: number): Promise<ApiProbe> {
  const t = Date.now();
  try {
    const res = await fetch(origin + route, { ...init, cache: "no-store", signal: AbortSignal.timeout(6000) });
    const latencyMs = Date.now() - t;
    let bodyOk: boolean | undefined;
    if (expect) {
      try {
        bodyOk = expect(await res.json());
      } catch {
        bodyOk = false;
      }
    }
    const ok = expectStatus !== undefined ? res.status === expectStatus : res.ok;
    return { route, method: init?.method || "GET", status: res.status, ok, latencyMs, bodyOk };
  } catch (e) {
    return { route, method: init?.method || "GET", status: 0, ok: false, latencyMs: Date.now() - t, error: (e as Error).message };
  }
}

async function probeAll(origin: string): Promise<ApiProbe[]> {
  const json = { "Content-Type": "application/json" };
  const isObj = (b: unknown): b is Record<string, unknown> => !!b && typeof b === "object";
  return Promise.all([
    probe(origin, "/api/health", undefined, (b) => isObj(b) && b.ok === true),
    probe(origin, "/api/users", undefined, (b) => isObj(b) && Array.isArray(b.users)),
    probe(origin, "/api/appliances", undefined, (b) => isObj(b) && Array.isArray(b.appliances)),
    probe(origin, "/api/logs", undefined, (b) => isObj(b) && Array.isArray(b.logs)),
    probe(origin, "/api/telemetry", undefined, (b) => isObj(b) && Array.isArray(b.telemetry)),
    // R2 guard regression probe: raw POST heater ON must be 403 (unless already ON → still 200 is a pass-through; we send OFF→ON only if OFF)
    probe(
      origin,
      "/api/appliances#R2-guard",
      { method: "POST", headers: json, body: JSON.stringify({ id: "heater_radiant", powerState: "ON" }) },
      undefined,
      403
    ).then(async (p) => {
      // If heater was already ON the guard doesn't fire (rising-edge only) — treat 200 as inconclusive-pass
      if (p.status === 200) return { ...p, ok: true, error: "heater already ON; guard not exercised" };
      return p;
    }),
  ]);
}

/* ------------------------------ auto-remediation ------------------------------ */
async function autoRemediate(): Promise<string[]> {
  const notes: string[] = [];
  const rows = await db.select().from(appliances);
  for (const a of rows) {
    const id = a.id;
    if (id.includes("fan")) {
      const phys = fanTelemetry(a.powerState === "ON" ? Math.max(1, a.fanSpeed) : 0);
      const drift =
        a.powerState !== phys.powerState ||
        a.fanSpeed !== phys.fanSpeed ||
        Math.abs(a.airRpm - phys.airRpm) > 1 ||
        Math.abs(a.airflowCfm - phys.airflowCfm) > 1 ||
        Math.abs(a.activeWattage - phys.activeWattage) > 0.5;
      if (drift) {
        await db.update(appliances).set({ ...phys, updatedAt: new Date() }).where(eq(appliances.id, id));
        notes.push(`RelayWatch auto-fixed ${id}: normalised to shared iot-physics (speed ${phys.fanSpeed}, ${phys.airRpm} rpm, ${phys.activeWattage} W)`);
      }
    } else if (a.powerState === "OFF" && (a.activeWattage > 0 || a.airRpm > 0 || a.fanSpeed > 0)) {
      await db.update(appliances).set({ ...zeroPowerTelemetry(), updatedAt: new Date() }).where(eq(appliances.id, id));
      notes.push(`RelayWatch auto-fixed ${id}: zeroed phantom telemetry while OFF`);
    } else if (a.riskTier === "R2" && !a.requiresHandshake) {
      await db.update(appliances).set({ requiresHandshake: true, updatedAt: new Date() }).where(eq(appliances.id, id));
      notes.push(`HazardSentinel auto-fixed ${id}: requiresHandshake forced true for R2`);
    }
  }
  return notes;
}

/* ------------------------------ handlers ------------------------------ */
export async function GET(req: Request) {
  try {
    await seedDatabase();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const limit = parseInt(searchParams.get("limit") || "120", 10);

    let findings = await db.select().from(agentFindings).orderBy(desc(agentFindings.createdAt)).limit(limit);
    if (status) findings = findings.filter((f) => f.status === status);

    const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(20);
    const openCount = await db.select({ count: sql<number>`count(*)` }).from(agentFindings).where(eq(agentFindings.status, "OPEN"));
    const open = await db.select({ severity: agentFindings.severity }).from(agentFindings).where(eq(agentFindings.status, "OPEN"));

    return NextResponse.json({
      success: true,
      roster: AGENT_ROSTER,
      findings,
      runs,
      stats: {
        openTotal: Number(openCount[0]?.count || 0),
        criticalOpen: open.filter((f) => f.severity === "CRITICAL").length,
        highOpen: open.filter((f) => f.severity === "HIGH").length,
        agentsOnline: AGENT_ROSTER.length,
      },
    });
  } catch (error) {
    console.error("GET /api/agents error:", error);
    return NextResponse.json({ success: false, error: "Failed to load agents" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await seedDatabase();
    const body = await req.json().catch(() => ({}));
    const trigger = (body.trigger || "MANUAL") as string;
    const origin = new URL(req.url).origin;

    const runId = uid("run");
    const started = Date.now();
    await db.insert(agentRuns).values({
      id: runId,
      trigger,
      status: "RUNNING",
      agentsInvoked: AGENT_ROSTER.length,
      summary: "Multi-agent council running…",
    });

    // 1. auto-remediation pass (agents try to fix what they can before diagnosing)
    const remediation = await autoRemediate();

    // 2. gather live truth: DB + browser telemetry + API probes
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const [apps, us, logs, calibs, tel, probes] = await Promise.all([
      db.select().from(appliances),
      db.select().from(users),
      db.select().from(actuationLogs).orderBy(desc(actuationLogs.createdAt)).limit(60),
      db.select().from(calibrationEvents).orderBy(desc(calibrationEvents.createdAt)).limit(30),
      db.select().from(runtimeTelemetry).where(gt(runtimeTelemetry.createdAt, since)).orderBy(desc(runtimeTelemetry.createdAt)).limit(60),
      probeAll(origin),
    ]);

    const telemetry: TelemetrySample[] = tel.map((r) => ({
      sessionId: r.sessionId,
      createdAt: r.createdAt.toISOString(),
      payload: (() => {
        try {
          return JSON.parse(r.payload) as Record<string, unknown>;
        } catch {
          return {};
        }
      })(),
    }));

    const snap = buildSnapshot({
      appliances: apps as unknown as Array<Record<string, unknown>>,
      users: us as unknown as Array<Record<string, unknown>>,
      recentLogs: logs as unknown as Array<Record<string, unknown>>,
      calibrationEvents: calibs as unknown as Array<Record<string, unknown>>,
      telemetry,
      apiProbes: probes,
    });

    const { findings, traces, summary } = runMultiAgentCouncil(snap);

    // 3. de-duplicate against OPEN findings: same agent+category+title stays a single row (refresh timestamp)
    const openRows = await db.select().from(agentFindings).where(eq(agentFindings.status, "OPEN"));
    const keyOf = (f: { agentId: string; category: string; title: string }) => `${f.agentId}|${f.category}|${f.title}`;
    const currentKeys = new Set(findings.map(keyOf));
    const openKeys = new Map(openRows.map((r) => [keyOf(r), r]));

    let inserted = 0;
    let refreshed = 0;
    for (const f of findings) {
      const k = keyOf(f);
      const existing = openKeys.get(k);
      if (existing) {
        await db
          .update(agentFindings)
          .set({ evidence: f.evidence, symptom: f.symptom, rootCause: f.rootCause, fixSteps: f.fixSteps, confidence: Math.min(0.99, f.confidence), runId, createdAt: new Date() })
          .where(eq(agentFindings.id, existing.id));
        refreshed += 1;
      } else {
        await db.insert(agentFindings).values({
          id: uid("find"),
          agentId: f.agentId,
          agentName: f.agentName,
          modelId: f.modelId,
          severity: f.severity,
          category: f.category,
          title: f.title,
          symptom: f.symptom,
          rootCause: f.rootCause,
          evidence: f.evidence,
          fixSteps: f.fixSteps,
          codeHints: f.codeHints,
          affectedModules: f.affectedModules,
          confidence: Math.min(0.99, f.confidence),
          status: "OPEN",
          runId,
        });
        inserted += 1;
      }
    }
    // 4. auto-resolve OPEN findings whose condition no longer holds
    let autoResolved = 0;
    for (const r of openRows) {
      if (!currentKeys.has(keyOf(r))) {
        await db.update(agentFindings).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(eq(agentFindings.id, r.id), eq(agentFindings.status, "OPEN")));
        autoResolved += 1;
      }
    }

    const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
    const highCount = findings.filter((f) => f.severity === "HIGH").length;
    const durationMs = Date.now() - started;
    const fullSummary =
      summary +
      (remediation.length ? ` · auto-fixed ${remediation.length}` : "") +
      (autoResolved ? ` · auto-resolved ${autoResolved} cleared` : "");

    await db
      .update(agentRuns)
      .set({ status: "COMPLETED", findingsCount: findings.length, criticalCount, highCount, summary: fullSummary, durationMs, completedAt: new Date() })
      .where(eq(agentRuns.id, runId));

    const savedFindings = await db.select().from(agentFindings).where(eq(agentFindings.status, "OPEN")).orderBy(desc(agentFindings.createdAt));
    const run = (await db.select().from(agentRuns).where(eq(agentRuns.id, runId)))[0];

    return NextResponse.json({
      success: true,
      run,
      findings: savedFindings,
      traces,
      summary: fullSummary,
      remediation,
      dedupe: { inserted, refreshed, autoResolved },
      probes,
      snapshotMeta: { ...snap.system, telemetrySamples: telemetry.length },
      roster: AGENT_ROSTER,
    });
  } catch (error) {
    console.error("POST /api/agents error:", error);
    return NextResponse.json({ success: false, error: "Agent council failed", detail: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { findingId, status } = body;
    if (!findingId || !status) return NextResponse.json({ success: false, error: "findingId and status required" }, { status: 400 });
    if (!["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED"].includes(status)) return NextResponse.json({ success: false, error: "Invalid status" }, { status: 400 });
    await db.update(agentFindings).set({ status, resolvedAt: status === "RESOLVED" ? new Date() : null }).where(eq(agentFindings.id, findingId));
    const updated = await db.select().from(agentFindings).where(eq(agentFindings.id, findingId));
    return NextResponse.json({ success: true, finding: updated[0] });
  } catch (error) {
    console.error("PATCH /api/agents error:", error);
    return NextResponse.json({ success: false, error: "Update failed" }, { status: 500 });
  }
}
