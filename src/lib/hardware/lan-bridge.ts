import type {
  LanActuationResult,
  LanDriverType,
  SafetyRiskTier,
} from "../../../.swarm/contracts/types";
import { ActuatorCircuitBreaker } from "../policy/safety-chord-engine";

/**
 * Subagent S10 — Local LAN Hardware Bridge (Matter 1.4 / Home Assistant / MQTT / Tasmota)
 * Executes 100% offline local LAN appliance actuation with an 800ms AbortController timeout,
 * Tier 3 Two-Step Safety Chord verification, and 3-strike Circuit Breaker protection.
 */

export const globalActuatorCircuitBreaker = new ActuatorCircuitBreaker(3);

export interface LanTargetDevice {
  id: string;
  name?: string;
  riskTier: SafetyRiskTier;
  driver?: LanDriverType;
  lanEndpointUrl?: string; // e.g. http://127.0.0.1:8123/api/services/switch/toggle
  mqttTopic?: string;
  espPin?: number;
}

export interface SafetyProofPayload {
  chordVerified: boolean;
  simulateFault?: boolean;
  timeoutMs?: number;
}

export async function dispatchLanActuation(
  device: LanTargetDevice,
  command: string,
  safetyProof: SafetyProofPayload,
  breaker: ActuatorCircuitBreaker = globalActuatorCircuitBreaker
): Promise<LanActuationResult> {
  const t0 = performance.now();
  const driver: LanDriverType = device.driver || "LOCAL_DB_SIMULATOR";

  // 1. Check Circuit Breaker Lock first
  if (breaker.isLocked(device.id)) {
    return {
      ok: false,
      deviceId: device.id,
      driver,
      command,
      simulated: driver === "LOCAL_DB_SIMULATOR",
      latencyMs: Math.round((performance.now() - t0) * 100) / 100,
      circuitBreakerState: "OPEN_FAULT_LOCKED",
      reasonCode: "DEVICE_FAULT_LOCK",
      error: "Action blocked: Target appliance reporting component degradation (Circuit Breaker OPEN).",
    };
  }

  // 2. Enforce Tier 3 Two-Step Safety Chord requirement
  if (device.riskTier === 3 && !safetyProof.chordVerified) {
    return {
      ok: false,
      deviceId: device.id,
      driver,
      command,
      simulated: driver === "LOCAL_DB_SIMULATOR",
      latencyMs: Math.round((performance.now() - t0) * 100) / 100,
      circuitBreakerState: "CLOSED_HEALTHY",
      reasonCode: "TIER_3_CHORD_REQUIRED",
      error: "Tier 3 high-risk appliance requires Two-Step Gesture Chord (OPEN_PALM -> FIST).",
    };
  }

  // 3. Handle explicit fault simulation for chaos/circuit-breaker verification
  if (safetyProof.simulateFault) {
    const faultStatus = breaker.recordFault(device.id);
    return {
      ok: false,
      deviceId: device.id,
      driver,
      command,
      simulated: true,
      latencyMs: Math.round((performance.now() - t0) * 100) / 100,
      circuitBreakerState: faultStatus.tripped ? "OPEN_FAULT_LOCKED" : "CLOSED_HEALTHY",
      reasonCode: faultStatus.tripped ? "DEVICE_FAULT_LOCK" : "ACK_MISSING",
      error: `Simulated relay timeout (#${faultStatus.faults})`,
    };
  }

  // 4. Local LAN HTTP/RPC dispatch when an explicit loopback/LAN endpoint is configured
  if (driver !== "LOCAL_DB_SIMULATOR" && device.lanEndpointUrl) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(800, safetyProof.timeoutMs ?? 800)
    );
    try {
      const res = await fetch(device.lanEndpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: device.id,
          command,
          mqttTopic: device.mqttTopic,
          espPin: device.espPin,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const faultStatus = breaker.recordFault(device.id);
        return {
          ok: false,
          deviceId: device.id,
          driver,
          command,
          simulated: false,
          latencyMs: Math.round((performance.now() - t0) * 100) / 100,
          circuitBreakerState: faultStatus.tripped ? "OPEN_FAULT_LOCKED" : "CLOSED_HEALTHY",
          reasonCode: faultStatus.tripped ? "DEVICE_FAULT_LOCK" : "ACK_MISSING",
          error: `LAN HTTP ${res.status}`,
        };
      }
      breaker.recordSuccess(device.id);
      return {
        ok: true,
        deviceId: device.id,
        driver,
        command,
        simulated: false,
        latencyMs: Math.round((performance.now() - t0) * 100) / 100,
        circuitBreakerState: "CLOSED_HEALTHY",
        reasonCode: "OK",
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const faultStatus = breaker.recordFault(device.id);
      return {
        ok: false,
        deviceId: device.id,
        driver,
        command,
        simulated: false,
        latencyMs: Math.round((performance.now() - t0) * 100) / 100,
        circuitBreakerState: faultStatus.tripped ? "OPEN_FAULT_LOCKED" : "CLOSED_HEALTHY",
        reasonCode: faultStatus.tripped ? "DEVICE_FAULT_LOCK" : "ACK_MISSING",
        error: (err as Error)?.message || "LAN timeout",
      };
    }
  }

  // 5. Default offline-first local DB simulator
  breaker.recordSuccess(device.id);
  return {
    ok: true,
    deviceId: device.id,
    driver: "LOCAL_DB_SIMULATOR",
    command,
    simulated: true,
    latencyMs: Math.round((performance.now() - t0) * 100) / 100,
    circuitBreakerState: "CLOSED_HEALTHY",
    reasonCode: "OK",
  };
}
