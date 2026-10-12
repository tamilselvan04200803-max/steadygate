import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, calibrationEvents } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, gestureToCalibrate, palmScale, fingerFlexibility, currentConfidence } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: "userId is required" }, { status: 400 });
    }

    const userRecords = await db.select().from(users).where(eq(users.id, userId));
    if (userRecords.length === 0) {
      return NextResponse.json({ success: false, error: "User not found" }, { status: 404 });
    }

    const currentUser = userRecords[0];
    let prototypes: Record<string, { confidenceBoost: number; flexTol: number }> = {};

    if (currentUser.personalizedPrototypes) {
      try {
        prototypes = JSON.parse(currentUser.personalizedPrototypes);
      } catch {
        prototypes = {};
      }
    }

    // Adapt prototype for the specified gesture
    if (gestureToCalibrate) {
      const existing = prototypes[gestureToCalibrate] || { confidenceBoost: 1.0, flexTol: 0.2 };
      // Increase confidence boost for user's personal gesture execution
      prototypes[gestureToCalibrate] = {
        confidenceBoost: Math.min(1.25, Math.round((existing.confidenceBoost + 0.05) * 100) / 100),
        flexTol: Math.min(0.35, Math.round((existing.flexTol + 0.03) * 100) / 100),
      };
    }

    const updatedPalmScale =
      palmScale !== undefined ? palmScale : currentUser.palmScale || 1.0;
    // AdaptLearner clamp: fingerFlexibility ∈ [0.75, 1.15]
    const rawFlex =
      fingerFlexibility !== undefined
        ? fingerFlexibility
        : currentUser.fingerFlexibility || 1.0;
    const updatedFingerFlexibility = Math.max(0.75, Math.min(1.15, rawFlex));

    await db
      .update(users)
      .set({
        palmScale: updatedPalmScale,
        fingerFlexibility: updatedFingerFlexibility,
        personalizedPrototypes: JSON.stringify(prototypes),
        lastCalibratedAt: new Date(),
      })
      .where(eq(users.id, userId));

    await db.insert(calibrationEvents).values({
      id: `pers_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId,
      previousAmplitude: currentUser.amplitudeRms,
      newAmplitude: currentUser.amplitudeRms,
      f0Hz: currentUser.f0Hz,
      reason: gestureToCalibrate
        ? `Personalized Prototype Adaptation for ${gestureToCalibrate}`
        : `Personal Hand Parameterization Update`,
    });

    const updatedUser = await db.select().from(users).where(eq(users.id, userId));

    return NextResponse.json({
      success: true,
      user: updatedUser[0],
      prototypes,
      message: gestureToCalibrate
        ? `Model adapted to personalized execution of ${gestureToCalibrate}!`
        : `Hand parameters updated!`,
    });
  } catch (error) {
    console.error("POST /api/personalize error:", error);
    return NextResponse.json({ success: false, error: "Personalization failed" }, { status: 500 });
  }
}
