import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, calibrationEvents } from "@/db/schema";
import { extractMotionSignature } from "@/lib/signal-processing";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, userName, condition, trajectoryY, presetCondition, medicationPhase } = body;

    let points: number[] = [];

    if (Array.isArray(trajectoryY) && trajectoryY.length >= 30) {
      points = trajectoryY;
    } else {
      // Synthesize realistic 10-second 30 FPS trajectory (300 points) based on requested profile
      const n = 300;
      const dt = 1 / 30;
      let targetF0 = 5.2;
      let targetAmp = 0.045;

      if (presetCondition === "parkinson") {
        targetF0 = 5.2; // 4-6 Hz characteristic resting/postural tremor
        targetAmp = 0.048;
      } else if (presetCondition === "essential_tremor") {
        targetF0 = 7.1; // 6-9 Hz characteristic action tremor
        targetAmp = 0.065;
      } else if (presetCondition === "steady") {
        targetF0 = 0.8;
        targetAmp = 0.007;
      } else if (presetCondition === "dystonia") {
        targetF0 = 4.3;
        targetAmp = 0.038;
      }

      for (let i = 0; i < n; i++) {
        const t = i * dt;
        // Linear drift + primary tremor sinusoid + secondary harmonic + Gaussian noise
        const drift = 0.02 * t;
        const tremor =
          targetAmp * Math.sin(2 * Math.PI * targetF0 * t) +
          0.3 * targetAmp * Math.sin(2 * Math.PI * (targetF0 * 1.8) * t);
        const noise = (Math.random() - 0.5) * 0.006;
        points.push(drift + tremor + noise);
      }
    }

    const { f0Hz, amplitudeRms, totalEnergy, spectrumPoints } = extractMotionSignature(
      points,
      30,
      2.5,
      12.0
    );

    const targetUserId = userId || `user_${Date.now()}`;
    const name = userName || (presetCondition ? `User (${presetCondition})` : "Enrolled Participant");
    const userCondition =
      condition ||
      (presetCondition === "parkinson"
        ? "Parkinson's Disease (Postural Tremor)"
        : presetCondition === "essential_tremor"
        ? "Essential Tremor"
        : presetCondition === "steady"
        ? "Healthy Control (Steady)"
        : "Motor Impairment Profile");

    const adaptiveDwell = Math.round((1.0 + amplitudeRms * 8.0) * 100) / 100;
    const attentionFloor = amplitudeRms > 0.03 ? 0.55 : 0.65;
    const notchBandwidth = f0Hz > 2.0 ? 2.0 : 1.0;

    // Check existing
    const existing = await db.select().from(users).where(eq(users.id, targetUserId));
    if (existing.length > 0) {
      await db
        .update(users)
        .set({
          name,
          condition: userCondition,
          f0Hz,
          amplitudeRms,
          notchBandwidthHz: notchBandwidth,
          attentionFloor,
          adaptiveDwellFactor: adaptiveDwell,
          medicationPhase: medicationPhase || existing[0].medicationPhase,
          lastCalibratedAt: new Date(),
        })
        .where(eq(users.id, targetUserId));
    } else {
      await db.insert(users).values({
        id: targetUserId,
        name,
        condition: userCondition,
        f0Hz,
        amplitudeRms,
        notchBandwidthHz: notchBandwidth,
        attentionFloor,
        adaptiveDwellFactor: adaptiveDwell,
        medicationPhase: medicationPhase || "Baseline",
      });
    }

    // Record calibration event
    await db.insert(calibrationEvents).values({
      id: `calib_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      userId: targetUserId,
      previousAmplitude: existing.length > 0 ? existing[0].amplitudeRms : 0,
      newAmplitude: amplitudeRms,
      f0Hz,
      reason: "10-Second Continuous Landmark Enrolment (F1)",
    });

    const savedUser = await db.select().from(users).where(eq(users.id, targetUserId));

    return NextResponse.json({
      success: true,
      user: savedUser[0],
      signature: {
        f0Hz,
        amplitudeRms,
        totalEnergy,
        notchBandwidthHz: notchBandwidth,
        adaptiveDwellFactor: adaptiveDwell,
      },
      spectrumPoints,
      sampleCount: points.length,
      sampleRateHz: 30,
    });
  } catch (error) {
    console.error("POST /api/enrol error:", error);
    return NextResponse.json({ success: false, error: "Enrolment failed" }, { status: 500 });
  }
}
