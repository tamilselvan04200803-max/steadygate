import { NextResponse } from "next/server";
import { db } from "@/db";
import { runtimeTelemetry, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  appendJsonlLog,
  readJsonStorage,
  readRecentJsonlLines,
  upsertPersonalizedUserStorage,
} from "@/lib/storage-logger";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const storedProfiles = readJsonStorage<{
      updatedAt: string;
      users: Record<string, Record<string, unknown>>;
    }>("users_personalized.json", {
      updatedAt: new Date().toISOString(),
      users: {},
    });

    const recentObservations = readRecentJsonlLines("user_observations.jsonl", 40);
    const enrolmentHistory = readRecentJsonlLines("enrolment_history.jsonl", 20);
    const actuationEvents = readRecentJsonlLines("actuation_events.jsonl", 40);

    return NextResponse.json({
      success: true,
      storedProfiles,
      recentObservations,
      enrolmentHistory,
      actuationEvents,
      files: {
        usersStorage: "storage/users_personalized.json",
        appliancesStorage: "storage/appliance_states.json",
        observationsLog: "logs/user_observations.jsonl",
        enrolmentLog: "logs/enrolment_history.jsonl",
        actuationLog: "logs/actuation_events.jsonl",
      },
    });
  } catch (error) {
    console.error("GET /api/user-data error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load stored user data" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userId,
      userName,
      condition,
      medicationPhase,
      f0Hz,
      amplitudeRms,
      stabilityRaw,
      stabilityNorm,
      gesture,
      confidence,
      margin,
      attention,
      sceneQuality,
      handParams,
      streamSource,
      selectedApplianceId,
    } = body;

    if (!userId) {
      return NextResponse.json(
        { success: false, error: "userId is required" },
        { status: 400 }
      );
    }

    const observationEntry = {
      event: "background_user_observation",
      userId,
      userName: userName || "Active User",
      condition: condition || "Motor Profile",
      medicationPhase: medicationPhase || "Active",
      streamSource: streamSource || "SIMULATED",
      kinematics: {
        f0Hz: Number(f0Hz ?? 5.2),
        amplitudeRms: Number(amplitudeRms ?? 0.045),
        stabilityRaw: Number(stabilityRaw ?? 0.5),
        stabilityNorm: Number(stabilityNorm ?? 0.85),
      },
      gestureRecognition: {
        gesture: gesture || "UNKNOWN",
        confidence: Number(confidence ?? 0.9),
        margin: Number(margin ?? 0.3),
        attention: Number(attention ?? 0.85),
        sceneQuality: Number(sceneQuality ?? 0.9),
      },
      handMorphology: handParams || null,
      selectedApplianceId: selectedApplianceId || null,
    };

    // 1. Append to persistent JSONL observation log (logs/user_observations.jsonl)
    appendJsonlLog("user_observations.jsonl", observationEntry);

    // 2. Update persistent user storage profile (storage/users_personalized.json & storage/user_<id>_profile.json)
    const existingUsers = await db.select().from(users).where(eq(users.id, String(userId)));
    const dbUser = existingUsers[0] || {};
    upsertPersonalizedUserStorage({
      ...dbUser,
      id: userId,
      name: userName || dbUser.name || "Active User",
      condition: condition || dbUser.condition || "Motor Profile",
      medicationPhase: medicationPhase || dbUser.medicationPhase || "Active",
      latestKinematics: observationEntry.kinematics,
      latestHandMorphology: handParams || null,
      latestGesture: observationEntry.gestureRecognition,
    });

    // 3. Record in DB runtimeTelemetry table
    await db.insert(runtimeTelemetry).values({
      id: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: String(userId),
      source: "background_observation",
      payload: JSON.stringify(observationEntry),
    });

    return NextResponse.json({
      success: true,
      savedTo: [
        "logs/user_observations.jsonl",
        "storage/users_personalized.json",
        `storage/user_${userId}_profile.json`,
      ],
    });
  } catch (error) {
    console.error("POST /api/user-data error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to persist background user observation" },
      { status: 500 }
    );
  }
}
