import type { RecognizedGesture } from "../types";
import type {
  ChordStage,
  SafetyChordState,
  SafetyRiskTier,
} from "../../../.swarm/contracts/types";

/**
 * Subagent S9 — Unified TypeScript Policy & 3-Tier Safety Chord Engine
 * Enforces Ampere-load risk tiers, Two-Step Gesture Chords (OPEN_PALM -> FIST)
 * for Tier 3 high-risk appliances (locks, space heaters >= 8A, water boilers),
 * and a 3-strike Actuator Circuit Breaker (`DEVICE_FAULT_LOCK`).
 */

export class ActuatorCircuitBreaker {
  private consecutiveFaults = new Map<string, number>();
  private lockedDevices = new Set<string>();
  private readonly faultThreshold: number;

  constructor(faultThreshold: number = 3) {
    this.faultThreshold = faultThreshold;
  }

  recordSuccess(deviceId: string): void {
    if (!this.lockedDevices.has(deviceId)) {
      this.consecutiveFaults.set(deviceId, 0);
    }
  }

  recordFault(deviceId: string): { tripped: boolean; faults: number } {
    const count = (this.consecutiveFaults.get(deviceId) || 0) + 1;
    this.consecutiveFaults.set(deviceId, count);
    if (count >= this.faultThreshold) {
      this.lockedDevices.add(deviceId);
    }
    return { tripped: this.lockedDevices.has(deviceId), faults: count };
  }

  isLocked(deviceId: string): boolean {
    return this.lockedDevices.has(deviceId);
  }

  resetDevice(deviceId: string): void {
    this.lockedDevices.delete(deviceId);
    this.consecutiveFaults.set(deviceId, 0);
  }
}

export function resolveApplianceRiskTier(
  amperageA: number,
  categoryOrRiskTier?: string
): SafetyRiskTier {
  const tag = (categoryOrRiskTier || "").toUpperCase();
  if (
    amperageA >= 8.0 ||
    tag === "R3" ||
    tag === "HIGH" ||
    tag.includes("LOCK") ||
    tag.includes("DEADBOLT") ||
    tag.includes("HEATER") ||
    tag.includes("BOILER")
  ) {
    return 3;
  }
  if (amperageA >= 2.0 || tag === "R2" || tag === "R1" || tag === "MEDIUM") {
    return 2;
  }
  return 1;
}

export class SafetyChordEngine {
  private stage: ChordStage = "IDLE";
  private openPalmAccumMs = 0;
  private armedAtMs = 0;
  private fistHoldAccumMs = 0;
  private lastTickMs: number | null = null;

  constructor(
    private readonly step1OpenPalmMs = 350,
    private readonly transitionWindowMs = 2500,
    private readonly step2FistHoldMs = 1500
  ) {}

  reset(): void {
    this.stage = "IDLE";
    this.openPalmAccumMs = 0;
    this.armedAtMs = 0;
    this.fistHoldAccumMs = 0;
    this.lastTickMs = null;
  }

  /**
   * Evaluates a step of the 3-tier safety policy.
   */
  evaluateStep(params: {
    deviceId: string;
    riskTier: SafetyRiskTier;
    committedGesture: RecognizedGesture;
    nowMs: number;
    isObjectGrasp?: boolean;
    rapidShakeAbort?: boolean;
    faceIntentVerified?: boolean;
    circuitBreaker?: ActuatorCircuitBreaker;
  }): SafetyChordState {
    const {
      deviceId,
      riskTier,
      committedGesture,
      nowMs,
      isObjectGrasp = false,
      rapidShakeAbort = false,
      faceIntentVerified = true,
      circuitBreaker,
    } = params;

    if (circuitBreaker?.isLocked(deviceId)) {
      this.stage = "DEVICE_FAULT_LOCK";
      return {
        deviceId,
        riskTier,
        stage: "DEVICE_FAULT_LOCK",
        chordVerified: false,
        progressPct: 0,
        remainingCountdownMs: 0,
        reason: "DEVICE_FAULT_LOCK",
      };
    }

    const dt =
      this.lastTickMs !== null
        ? Math.max(0, Math.min(250, nowMs - this.lastTickMs))
        : 33.3;
    this.lastTickMs = nowMs;

    if (isObjectGrasp || rapidShakeAbort) {
      this.stage = "CHORD_ABORTED_BY_USER";
      this.openPalmAccumMs = 0;
      this.fistHoldAccumMs = 0;
      return {
        deviceId,
        riskTier,
        stage: "CHORD_ABORTED_BY_USER",
        chordVerified: false,
        progressPct: 0,
        remainingCountdownMs: this.step2FistHoldMs,
        reason: "CHORD_ABORTED_BY_USER",
      };
    }

    // Tier 1 (<2A): Single gesture 350ms
    if (riskTier === 1) {
      if (committedGesture !== "UNKNOWN") {
        this.openPalmAccumMs += dt;
        const pct = Math.min(100, Math.round((this.openPalmAccumMs / 350) * 100));
        const verified = this.openPalmAccumMs >= 350;
        this.stage = verified ? "CHORD_VERIFIED" : "STEP_1_ARMING_OPEN_PALM";
        return {
          deviceId,
          riskTier,
          stage: this.stage,
          chordVerified: verified,
          progressPct: pct,
          remainingCountdownMs: Math.max(0, Math.round(350 - this.openPalmAccumMs)),
          reason: verified ? "TIER_1_SINGLE_GESTURE_VERIFIED" : "HOLDING_TIER_1",
        };
      }
      this.openPalmAccumMs = 0;
      this.stage = "IDLE";
      return {
        deviceId,
        riskTier,
        stage: "IDLE",
        chordVerified: false,
        progressPct: 0,
        remainingCountdownMs: 350,
        reason: "IDLE",
      };
    }

    // Tier 2 (2-8A): Single gesture 600ms + faceIntentVerified
    if (riskTier === 2) {
      if (!faceIntentVerified) {
        this.openPalmAccumMs = 0;
        this.stage = "IDLE";
        return {
          deviceId,
          riskTier,
          stage: "IDLE",
          chordVerified: false,
          progressPct: 0,
          remainingCountdownMs: 600,
          reason: "USER_DISTRACTED",
        };
      }
      if (committedGesture !== "UNKNOWN") {
        this.openPalmAccumMs += dt;
        const pct = Math.min(100, Math.round((this.openPalmAccumMs / 600) * 100));
        const verified = this.openPalmAccumMs >= 600;
        this.stage = verified ? "CHORD_VERIFIED" : "STEP_1_ARMING_OPEN_PALM";
        return {
          deviceId,
          riskTier,
          stage: this.stage,
          chordVerified: verified,
          progressPct: pct,
          remainingCountdownMs: Math.max(0, Math.round(600 - this.openPalmAccumMs)),
          reason: verified ? "TIER_2_FACE_AND_HOLD_VERIFIED" : "HOLDING_TIER_2",
        };
      }
      this.openPalmAccumMs = 0;
      this.stage = "IDLE";
      return {
        deviceId,
        riskTier,
        stage: "IDLE",
        chordVerified: false,
        progressPct: 0,
        remainingCountdownMs: 600,
        reason: "IDLE",
      };
    }

    // Tier 3 (>=8A or DOOR_LOCK): Two-Step Gesture Chord (OPEN_PALM 350ms -> FIST within 2500ms -> hold 1500ms)
    if (
      this.stage === "IDLE" ||
      this.stage === "CHORD_ABORTED_BY_USER" ||
      this.stage === "STEP_1_ARMING_OPEN_PALM"
    ) {
      if (committedGesture === "OPEN_PALM") {
        this.openPalmAccumMs += dt;
        if (this.openPalmAccumMs >= this.step1OpenPalmMs) {
          this.stage = "STEP_1_ARMED_AWAITING_FIST";
          this.armedAtMs = nowMs;
          this.fistHoldAccumMs = 0;
          return {
            deviceId,
            riskTier,
            stage: this.stage,
            chordVerified: false,
            progressPct: 35,
            remainingCountdownMs: this.step2FistHoldMs,
            reason: "STEP_1_OPEN_PALM_ARMED_TRANSITION_TO_FIST",
          };
        }
        this.stage = "STEP_1_ARMING_OPEN_PALM";
        return {
          deviceId,
          riskTier,
          stage: this.stage,
          chordVerified: false,
          progressPct: Math.min(34, Math.round((this.openPalmAccumMs / this.step1OpenPalmMs) * 34)),
          remainingCountdownMs: this.step2FistHoldMs,
          reason: "ARMING_STEP_1_OPEN_PALM",
        };
      } else {
        this.openPalmAccumMs = 0;
        this.stage = "IDLE";
        return {
          deviceId,
          riskTier,
          stage: "IDLE",
          chordVerified: false,
          progressPct: 0,
          remainingCountdownMs: this.step2FistHoldMs,
          reason: "TIER_3_REQUIRES_OPEN_PALM_THEN_FIST_CHORD",
        };
      }
    }

    if (
      this.stage === "STEP_1_ARMED_AWAITING_FIST" ||
      this.stage === "STEP_2_COUNTDOWN_HOLD" ||
      this.stage === "CHORD_VERIFIED"
    ) {
      if (
        this.stage === "STEP_1_ARMED_AWAITING_FIST" &&
        nowMs - this.armedAtMs > this.transitionWindowMs
      ) {
        this.reset();
        return {
          deviceId,
          riskTier,
          stage: "IDLE",
          chordVerified: false,
          progressPct: 0,
          remainingCountdownMs: this.step2FistHoldMs,
          reason: "CHORD_TRANSITION_TIMEOUT",
        };
      }

      if (committedGesture === "FIST") {
        this.fistHoldAccumMs += dt;
        const holdRatio = Math.min(1, this.fistHoldAccumMs / this.step2FistHoldMs);
        const progressPct = Math.min(100, Math.round(35 + holdRatio * 65));
        const remaining = Math.max(0, Math.round(this.step2FistHoldMs - this.fistHoldAccumMs));
        if (this.fistHoldAccumMs >= this.step2FistHoldMs) {
          this.stage = "CHORD_VERIFIED";
          return {
            deviceId,
            riskTier,
            stage: "CHORD_VERIFIED",
            chordVerified: true,
            progressPct: 100,
            remainingCountdownMs: 0,
            reason: "TIER_3_CHORD_VERIFIED",
          };
        }
        this.stage = "STEP_2_COUNTDOWN_HOLD";
        return {
          deviceId,
          riskTier,
          stage: "STEP_2_COUNTDOWN_HOLD",
          chordVerified: false,
          progressPct,
          remainingCountdownMs: remaining,
          reason: "HOLDING_STEP_2_FIST_COUNTDOWN",
        };
      }

      if (committedGesture === "OPEN_PALM" && this.stage === "STEP_1_ARMED_AWAITING_FIST") {
        return {
          deviceId,
          riskTier,
          stage: "STEP_1_ARMED_AWAITING_FIST",
          chordVerified: false,
          progressPct: 35,
          remainingCountdownMs: this.step2FistHoldMs,
          reason: "AWAITING_FIST_TRANSITION",
        };
      }

      this.reset();
      return {
        deviceId,
        riskTier,
        stage: "IDLE",
        chordVerified: false,
        progressPct: 0,
        remainingCountdownMs: this.step2FistHoldMs,
        reason: "CHORD_RELEASED_BEFORE_COMPLETION",
      };
    }

    return {
      deviceId,
      riskTier,
      stage: this.stage,
      chordVerified: false,
      progressPct: 0,
      remainingCountdownMs: this.step2FistHoldMs,
      reason: "IDLE",
    };
  }
}
