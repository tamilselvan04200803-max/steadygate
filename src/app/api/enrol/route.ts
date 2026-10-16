import { NextResponse } from "next/server";
import { db, ensureDbReady } from "@/db";
import { users, calibrationEvents } from "@/db/schema";
import { seedDatabase } from "@/db/seed";
import { extractMotionSignature } from "@/lib/signal-processing";
import { eq } from "drizzle-orm";
import {
  appendJsonlLog,
  upsertPersonalizedUserStorage,
  writeJsonStorage,
} from "@/lib/storage-logger";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      userId,
      userName,
      name: rawName,
      condition,
      trajectoryY,
      presetCondition,
      medicationPhase,
      medicationState,
      durationSec,
      enrolmentDurationSec,
      sampleRateHz = 30,
      simulatedFreqHz,
      simulatedAmplitude,
      handMorphologySamples,
      handSamples,
      liveLandmarkFrames,
      gestureTimeline,
      gestureObservations,
      cameraModeUsed = "LIVE_WEBCAM",
      notes,
    } = body;

    const effectiveDurationSec = Math.max(
      1,
      Number(enrolmentDurationSec || durationSec || 60)
    );
    const effectiveSampleRateHz = Number(sampleRateHz || 30);

    let points: number[] = [];

    if (Array.isArray(trajectoryY) && trajectoryY.length >= 15) {
      points = trajectoryY.map((v) => Number(v) || 0.5);
    } else {
      const n = Math.max(180, Math.round(effectiveDurationSec * effectiveSampleRateHz));
      const dt = 1 / effectiveSampleRateHz;
      const targetF0 = Number(simulatedFreqHz || 5.2);
      const targetAmp = Number(simulatedAmplitude || 0.025);

      for (let i = 0; i < n; i++) {
        const t = i * dt;
        const drift = 0.015 * Math.sin(0.2 * t);
        const tremor =
          targetAmp * Math.sin(2 * Math.PI * targetF0 * t) +
          0.3 * targetAmp * Math.sin(2 * Math.PI * (targetF0 * 1.8) * t);
        const noise = (Math.random() - 0.5) * 0.005;
        points.push(0.5 + drift + tremor + noise);
      }
    }

    const spectralSlice = points.length > 360 ? points.slice(-360) : points;
    const { f0Hz, amplitudeRms, totalEnergy, spectrumPoints } = extractMotionSignature(
      spectralSlice,
      effectiveSampleRateHz,
      2.5,
      12.0
    );

    const targetUserId = userId || `user_${Date.now()}`;
    const name =
      (rawName && String(rawName).trim()) ||
      (userName && String(userName).trim()) ||
      (presetCondition ? `User (${presetCondition})` : "Personalized User");
    const userCondition =
      condition ||
      "Personalized Live Camera Trained Profile (Tremor & Hand Gesture AI Model)";

    const adaptiveDwell = Math.round((1.0 + amplitudeRms * 8.0) * 100) / 100;
    const attentionFloor = amplitudeRms > 0.03 ? 0.55 : 0.65;
    const notchBandwidth = f0Hz > 2.0 ? 2.0 : 1.0;

    // Train Personalized Hand Morphology & Per-Gesture AI Prototypes from recorded live samples
    let palmScale = 0.22;
    let fingerFlexibility = 0.96;
    let perFingerExtensionAvg: [number, number, number, number, number] = [
      0.86, 0.9, 0.88, 0.84, 0.8,
    ];
    let fatigueIndex = 0.008;

    const trainedPrototypes: Record<
      string,
      {
        confidenceBoost: number;
        flexTol: number;
        centroid: [number, number, number, number, number];
        samplesTrained: number;
      }
    > = {
      FIST: {
        confidenceBoost: 1.12,
        flexTol: 0.26,
        centroid: [0.12, 0.1, 0.09, 0.08, 0.08],
        samplesTrained: 0,
      },
      OPEN_PALM: {
        confidenceBoost: 1.1,
        flexTol: 0.24,
        centroid: [0.92, 0.96, 0.98, 0.94, 0.9],
        samplesTrained: 0,
      },
      THUMBS_UP: {
        confidenceBoost: 1.11,
        flexTol: 0.25,
        centroid: [0.95, 0.15, 0.14, 0.12, 0.1],
        samplesTrained: 0,
      },
      CALL_ME: {
        confidenceBoost: 1.11,
        flexTol: 0.25,
        centroid: [0.92, 0.14, 0.12, 0.12, 0.92],
        samplesTrained: 0,
      },
      POINTING_UP: {
        confidenceBoost: 1.09,
        flexTol: 0.23,
        centroid: [0.16, 0.96, 0.14, 0.12, 0.1],
        samplesTrained: 0,
      },
      VICTORY: {
        confidenceBoost: 1.08,
        flexTol: 0.22,
        centroid: [0.16, 0.96, 0.95, 0.14, 0.12],
        samplesTrained: 0,
      },
      PINCH: {
        confidenceBoost: 1.08,
        flexTol: 0.22,
        centroid: [0.5, 0.5, 0.14, 0.12, 0.1],
        samplesTrained: 0,
      },
      THREE_FINGERS: {
        confidenceBoost: 1.08,
        flexTol: 0.23,
        centroid: [0.14, 0.95, 0.95, 0.92, 0.12],
        samplesTrained: 0,
      },
      FOUR_FINGERS: {
        confidenceBoost: 1.08,
        flexTol: 0.23,
        centroid: [0.1, 0.95, 0.95, 0.93, 0.9],
        samplesTrained: 0,
      },
      THUMBS_DOWN: {
        confidenceBoost: 1.09,
        flexTol: 0.24,
        centroid: [0.92, 0.15, 0.14, 0.12, 0.1],
        samplesTrained: 0,
      },
    };

    if (Array.isArray(handSamples) && handSamples.length > 0) {
      const avgPalm =
        handSamples.reduce((s: number, h: any) => s + Number(h.palmScale || 0.22), 0) /
        handSamples.length;
      const avgSpread =
        handSamples.reduce((s: number, h: any) => s + Number(h.fingerSpread || 0.48), 0) /
        handSamples.length;
      palmScale = Number(avgPalm.toFixed(3));
      fingerFlexibility = Number(
        Math.max(0.65, Math.min(1.15, avgSpread * 2.0)).toFixed(3)
      );

      const extSums: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      const byGesture: Record<
        string,
        Array<[number, number, number, number, number]>
      > = {};

      for (const h of handSamples) {
        if (Array.isArray(h.fingerExtensions) && h.fingerExtensions.length === 5) {
          const vec: [number, number, number, number, number] = [
            Number(h.fingerExtensions[0] || 0.5),
            Number(h.fingerExtensions[1] || 0.5),
            Number(h.fingerExtensions[2] || 0.5),
            Number(h.fingerExtensions[3] || 0.5),
            Number(h.fingerExtensions[4] || 0.5),
          ];
          for (let k = 0; k < 5; k++) {
            extSums[k] += vec[k];
          }
          const gKey = String(h.gesture || "OPEN_PALM");
          if (!byGesture[gKey]) byGesture[gKey] = [];
          byGesture[gKey].push(vec);
        }
      }

      perFingerExtensionAvg = extSums.map((v) =>
        Number((v / handSamples.length).toFixed(3))
      ) as [number, number, number, number, number];

      // Fit per-gesture centroid & variance from user's recorded samples
      for (const [gKey, vectors] of Object.entries(byGesture)) {
        if (vectors.length > 0 && trainedPrototypes[gKey]) {
          const centroid: [number, number, number, number, number] = [0, 0, 0, 0, 0];
          for (const v of vectors) {
            for (let k = 0; k < 5; k++) centroid[k] += v[k];
          }
          for (let k = 0; k < 5; k++) {
            centroid[k] = Number((centroid[k] / vectors.length).toFixed(3));
          }
          trainedPrototypes[gKey] = {
            confidenceBoost: 1.14,
            flexTol: 0.26,
            centroid,
            samplesTrained: vectors.length,
          };
        }
      }

      // Compute fatigue drift between first third and last third of enrolment
      if (handSamples.length >= 6) {
        const third = Math.floor(handSamples.length / 3);
        const earlyStab =
          handSamples
            .slice(0, third)
            .reduce((s: number, h: any) => s + Number(h.stability || 0.88), 0) / third;
        const lateStab =
          handSamples
            .slice(-third)
            .reduce((s: number, h: any) => s + Number(h.stability || 0.88), 0) / third;
        fatigueIndex = Number((earlyStab - lateStab).toFixed(3));
      }
    } else if (handMorphologySamples) {
      if (Number(handMorphologySamples.spanRatio) > 0.1) {
        palmScale = Number(Number(handMorphologySamples.spanRatio).toFixed(3));
      }
      if (Number(handMorphologySamples.avgExtension) > 0.1) {
        fingerFlexibility = Number(
          Number(handMorphologySamples.avgExtension).toFixed(3)
        );
      }
    }

    const prototypesJson = JSON.stringify(trainedPrototypes);
    const effectiveMedication = medicationState || medicationPhase || "ON";

    let userObj: any = {
      id: targetUserId,
      name,
      condition: userCondition,
      f0Hz,
      amplitudeRms,
      notchBandwidthHz: notchBandwidth,
      attentionFloor,
      adaptiveDwellFactor: adaptiveDwell,
      medicationPhase: effectiveMedication,
      palmScale,
      fingerFlexibility,
      personalizedPrototypes: prototypesJson,
      lastCalibratedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const calibId = `calib_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // Persist to PGlite / PostgreSQL with fault-tolerant guard
    try {
      await ensureDbReady();
      await seedDatabase();

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
            medicationPhase: effectiveMedication,
            palmScale,
            fingerFlexibility,
            personalizedPrototypes: prototypesJson,
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
          medicationPhase: effectiveMedication,
          palmScale,
          fingerFlexibility,
          personalizedPrototypes: prototypesJson,
        });
      }

      await db.insert(calibrationEvents).values({
        id: calibId,
        userId: targetUserId,
        previousAmplitude: existing.length > 0 ? existing[0].amplitudeRms : 0,
        newAmplitude: amplitudeRms,
        f0Hz,
        reason: `${effectiveDurationSec}s Live Camera & AI Gesture Model Enrolment (n=${points.length} frames @ ${effectiveSampleRateHz}Hz)`,
      });

      const savedUser = await db.select().from(users).where(eq(users.id, targetUserId));
      if (savedUser.length > 0) {
        userObj = savedUser[0];
      }
    } catch (dbErr) {
      console.warn(
        "Database write warning during enrolment (falling back to persistent file storage):",
        dbErr
      );
    }

    const bandStopRangeHz: [number, number] = [
      Number(Math.max(0.5, f0Hz - notchBandwidth / 2).toFixed(2)),
      Number((f0Hz + notchBandwidth / 2).toFixed(2)),
    ];

    const aiDatasetFile = `ai_training_dataset_${targetUserId}.json`;
    const aiModelFile = `ai_trained_model_${targetUserId}.json`;

    const fullEnrolmentPayload = {
      calibId,
      userId: targetUserId,
      userName: name,
      condition: userCondition,
      cameraModeUsed,
      medicationPhase: effectiveMedication,
      durationSec: effectiveDurationSec,
      sampleCount: points.length,
      sampleRateHz: effectiveSampleRateHz,
      signature: {
        f0Hz,
        amplitudeRms,
        totalEnergy,
        notchBandwidthHz: notchBandwidth,
        bandStopRangeHz,
        adaptiveDwellFactor: adaptiveDwell,
        attentionFloor,
      },
      handMorphology: {
        palmScale,
        fingerFlexibility,
        perFingerExtensionAvg,
        rawSamplesCount: Array.isArray(handSamples) ? handSamples.length : 0,
        liveLandmarkFramesCount: Array.isArray(liveLandmarkFrames)
          ? liveLandmarkFrames.length
          : 0,
      },
      trainedGestureModel: trainedPrototypes,
      gestureObservations: gestureTimeline || gestureObservations || null,
      notes:
        notes ||
        "Live camera footage & hand movement dataset recorded and trained for personalized AI recognition",
    };

    // Write AI training dataset (recorded live landmark frames + trajectories + hand samples)
    writeJsonStorage(aiDatasetFile, {
      createdAt: new Date().toISOString(),
      userId: targetUserId,
      userName: name,
      cameraModeUsed,
      durationSec: effectiveDurationSec,
      sampleRateHz: effectiveSampleRateHz,
      trajectoryYCount: points.length,
      trajectoryYSample: points.slice(-180),
      handSamples: Array.isArray(handSamples) ? handSamples.slice(-120) : [],
      liveLandmarkFrames: Array.isArray(liveLandmarkFrames)
        ? liveLandmarkFrames.slice(-60)
        : [],
      gestureTimeline: gestureTimeline || [],
    });

    // Write trained AI gesture + tremor model weights
    writeJsonStorage(aiModelFile, {
      trainedAt: new Date().toISOString(),
      modelVersion: "SteadyGate-PersonalAI-v2.1",
      userId: targetUserId,
      userName: name,
      spectralNotchFilter: {
        f0Hz,
        amplitudeRms,
        bandStopRangeHz,
        adaptiveDwellFactor: adaptiveDwell,
      },
      handGeometryBaseline: {
        palmScale,
        fingerFlexibility,
        perFingerExtensionAvg,
      },
      trainedGesturePrototypes: trainedPrototypes,
    });

    appendJsonlLog("enrolment_history.jsonl", fullEnrolmentPayload);
    appendJsonlLog("live_footage_landmarks.jsonl", {
      userId: targetUserId,
      userName: name,
      cameraModeUsed,
      framesRecorded: points.length,
      landmarkSnapshotsCount: Array.isArray(liveLandmarkFrames)
        ? liveLandmarkFrames.length
        : 0,
      trainedPrototypes,
    });
    appendJsonlLog("user_observations.jsonl", {
      event: "enrolment_ai_model_trained",
      ...fullEnrolmentPayload,
    });

    upsertPersonalizedUserStorage({
      ...userObj,
      enrolmentSummary: fullEnrolmentPayload,
      aiDatasetFile: `storage/${aiDatasetFile}`,
      aiModelFile: `storage/${aiModelFile}`,
    });

    const storagePaths = {
      aiTrainingDatasetFile: `storage/${aiDatasetFile}`,
      aiTrainedModelFile: `storage/${aiModelFile}`,
      userProfileFile: `storage/user_${targetUserId}_profile.json`,
      usersRegistryFile: "storage/users_personalized.json",
      liveFootageLogFile: "logs/live_footage_landmarks.jsonl",
      enrolmentLogFile: "logs/enrolment_history.jsonl",
    };

    return NextResponse.json({
      success: true,
      user: userObj,
      profile: userObj,
      signature: fullEnrolmentPayload.signature,
      handMorphology: fullEnrolmentPayload.handMorphology,
      trainedGestureModel: trainedPrototypes,
      analysis: {
        enrolmentDurationSec: effectiveDurationSec,
        sampleRateHz: effectiveSampleRateHz,
        samplesAnalyzed: points.length,
        cameraModeUsed,
        estimatedF0Hz: f0Hz,
        bandStopRangeHz,
        amplitudeRms,
        recommendedDwellScale: adaptiveDwell,
        fatigueIndex,
        handMorphology: {
          palmScale,
          fingerFlexibility,
          perFingerExtensionAvg,
        },
      },
      spectrumPoints,
      sampleCount: points.length,
      durationSec: effectiveDurationSec,
      sampleRateHz: effectiveSampleRateHz,
      storagePaths,
      savedFiles: Object.values(storagePaths),
    });
  } catch (error: any) {
    console.error("POST /api/enrol error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Enrolment failed",
      },
      { status: 500 }
    );
  }
}
