/**
 * SteadyGate v6.0 — Stage 5: Commit-on-Release Continuous Air-Dial Controller
 * ---------------------------------------------------------------------------
 * Allows users with 3.5-14 Hz tremor or 1-3 Hz dyskinesia to adjust continuous
 * smart-home parameters (fan speed, dimmer brightness, thermostat setpoint)
 * without physical sliders:
 *  - State machine: IDLE -> CLUTCH_ARMING -> DIAL_ACTIVE -> COMMIT_ON_RELEASE
 *  - Discrete ratchet detents (5% default, 10% under dyskinesia modulation) with 1.5% hysteresis
 *  - 150 ms Commit-on-Release rollback ring buffer so finger-opening "release throw"
 *    never corrupts the locked setpoint.
 */

import type { HandContactState100DOH, RecognizedGesture } from "../types";
import { STEADYGATE_V6_CONFIG } from "../../config/steadygate.config";

export type AirDialState =
  | "IDLE"
  | "CLUTCH_ARMING"
  | "DIAL_ACTIVE"
  | "COMMIT_ON_RELEASE";

export interface AirDialHistorySample {
  timestampMs: number;
  snappedValuePct: number;
  stabilizedY: number;
}

export interface AirDialEvaluationResult {
  state: AirDialState;
  currentValuePct: number;
  committedValuePct: number | null;
  detentStepPct: 5 | 10;
  armingProgressPct: number;
  rollbackApplied: boolean;
  preReleaseValuePct: number;
  instantReleaseValuePct: number;
}

export class AirDialClutchController {
  private state: AirDialState = "IDLE";
  private armStartMs: number | null = null;
  private anchorY = 0.5;
  private anchorValuePct = 50;
  private currentSnappedPct = 50;
  private lastCommittedPct: number | null = null;
  private history: AirDialHistorySample[] = [];
  private readonly armingHoldMs = 450;
  private readonly fullScaleSpanNorm = 0.35; // 0.35 normalized vertical span = 100% dial range

  constructor(initialValuePct: number = 50) {
    this.anchorValuePct = initialValuePct;
    this.currentSnappedPct = initialValuePct;
  }

  reset(initialValuePct: number = 50): void {
    this.state = "IDLE";
    this.armStartMs = null;
    this.anchorValuePct = initialValuePct;
    this.currentSnappedPct = initialValuePct;
    this.lastCommittedPct = null;
    this.history = [];
  }

  getState(): AirDialState {
    return this.state;
  }

  private snapToDetentWithHysteresis(
    rawPct: number,
    prevSnappedPct: number,
    stepPct: 5 | 10
  ): number {
    const clamped = Math.max(0, Math.min(100, rawPct));
    const nearestDetent = Math.round(clamped / stepPct) * stepPct;
    const hyst = STEADYGATE_V6_CONFIG.stage5Actuation.airDialHysteresisPct.value;
    // Stay on previous detent unless movement exceeds half-step + hysteresis deadband
    if (Math.abs(clamped - prevSnappedPct) < stepPct * 0.5 + hyst) {
      return prevSnappedPct;
    }
    return Math.max(0, Math.min(100, nearestDetent));
  }

  update(input: {
    gesture: RecognizedGesture;
    isCanonicalPinchEyelet: boolean;
    contactState: HandContactState100DOH;
    stabilizedPinchY: number;
    timestampMs: number;
    dyskinesiaActive?: boolean;
    sqiScore?: number;
  }): AirDialEvaluationResult {
    const stepPct: 5 | 10 = input.dyskinesiaActive
      ? (STEADYGATE_V6_CONFIG.stage5Actuation.airDialDyskinesiaDetentPct.value as 10)
      : (STEADYGATE_V6_CONFIG.stage5Actuation.airDialDefaultDetentPct.value as 5);
    const rollbackMs =
      STEADYGATE_V6_CONFIG.stage5Actuation.airDialReleaseRollbackMs.value;

    // Abort immediately if foreign contact veto or poor signal quality occurs
    if (input.contactState !== "NO_CONTACT" || (input.sqiScore !== undefined && input.sqiScore < 0.35)) {
      this.state = "IDLE";
      this.armStartMs = null;
      this.history = [];
      return {
        state: "IDLE",
        currentValuePct: this.currentSnappedPct,
        committedValuePct: this.lastCommittedPct,
        detentStepPct: stepPct,
        armingProgressPct: 0,
        rollbackApplied: false,
        preReleaseValuePct: this.currentSnappedPct,
        instantReleaseValuePct: this.currentSnappedPct,
      };
    }

    const isPinchActive =
      input.gesture === "PINCH" && input.isCanonicalPinchEyelet;

    if (this.state === "IDLE" || this.state === "COMMIT_ON_RELEASE") {
      if (isPinchActive) {
        this.state = "CLUTCH_ARMING";
        this.armStartMs = input.timestampMs;
        this.anchorY = input.stabilizedPinchY;
      } else {
        this.state = "IDLE";
      }
      return {
        state: this.state,
        currentValuePct: this.currentSnappedPct,
        committedValuePct: this.lastCommittedPct,
        detentStepPct: stepPct,
        armingProgressPct: isPinchActive ? 5 : 0,
        rollbackApplied: false,
        preReleaseValuePct: this.currentSnappedPct,
        instantReleaseValuePct: this.currentSnappedPct,
      };
    }

    if (this.state === "CLUTCH_ARMING") {
      if (!isPinchActive) {
        this.state = "IDLE";
        this.armStartMs = null;
        return {
          state: "IDLE",
          currentValuePct: this.currentSnappedPct,
          committedValuePct: this.lastCommittedPct,
          detentStepPct: stepPct,
          armingProgressPct: 0,
          rollbackApplied: false,
          preReleaseValuePct: this.currentSnappedPct,
          instantReleaseValuePct: this.currentSnappedPct,
        };
      }

      const elapsed = input.timestampMs - (this.armStartMs ?? input.timestampMs);
      const progress = Math.min(100, Math.round((elapsed / this.armingHoldMs) * 100));
      if (elapsed >= this.armingHoldMs) {
        this.state = "DIAL_ACTIVE";
        this.anchorY = input.stabilizedPinchY;
        this.anchorValuePct = this.currentSnappedPct;
        this.history = [
          {
            timestampMs: input.timestampMs,
            snappedValuePct: this.currentSnappedPct,
            stabilizedY: input.stabilizedPinchY,
          },
        ];
      }
      return {
        state: this.state,
        currentValuePct: this.currentSnappedPct,
        committedValuePct: this.lastCommittedPct,
        detentStepPct: stepPct,
        armingProgressPct: progress,
        rollbackApplied: false,
        preReleaseValuePct: this.currentSnappedPct,
        instantReleaseValuePct: this.currentSnappedPct,
      };
    }

    // DIAL_ACTIVE state
    const deltaY = this.anchorY - input.stabilizedPinchY; // upward hand motion = positive increase
    const rawPct = this.anchorValuePct + (deltaY / this.fullScaleSpanNorm) * 100;
    const instantSnapped = this.snapToDetentWithHysteresis(
      rawPct,
      this.currentSnappedPct,
      stepPct
    );

    if (isPinchActive) {
      this.currentSnappedPct = instantSnapped;
      this.history.push({
        timestampMs: input.timestampMs,
        snappedValuePct: instantSnapped,
        stabilizedY: input.stabilizedPinchY,
      });
      // Keep 500ms lookback buffer
      this.history = this.history.filter(
        (h) => input.timestampMs - h.timestampMs <= 500
      );

      return {
        state: "DIAL_ACTIVE",
        currentValuePct: this.currentSnappedPct,
        committedValuePct: this.lastCommittedPct,
        detentStepPct: stepPct,
        armingProgressPct: 100,
        rollbackApplied: false,
        preReleaseValuePct: this.currentSnappedPct,
        instantReleaseValuePct: instantSnapped,
      };
    }

    // User released pinch (PINCH -> OPEN_PALM / release):
    // Roll back to the detent value recorded at t_release - 150ms to eliminate finger-opening throw!
    const targetRollbackTs = input.timestampMs - rollbackMs;
    let rollbackSample = this.history[0];
    for (const h of this.history) {
      if (h.timestampMs <= targetRollbackTs) {
        rollbackSample = h;
      }
    }
    const rolledBackPct = rollbackSample
      ? rollbackSample.snappedValuePct
      : this.currentSnappedPct;
    const rollbackApplied = rolledBackPct !== instantSnapped;

    this.currentSnappedPct = rolledBackPct;
    this.anchorValuePct = rolledBackPct;
    this.lastCommittedPct = rolledBackPct;
    this.state = "COMMIT_ON_RELEASE";
    this.history = [];

    return {
      state: "COMMIT_ON_RELEASE",
      currentValuePct: rolledBackPct,
      committedValuePct: rolledBackPct,
      detentStepPct: stepPct,
      armingProgressPct: 100,
      rollbackApplied,
      preReleaseValuePct: rolledBackPct,
      instantReleaseValuePct: instantSnapped,
    };
  }
}
