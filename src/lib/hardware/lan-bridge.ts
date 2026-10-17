import crypto from "crypto";
import type {
  LanActuationResult,
  LanDriverType,
  SafetyRiskTier,
} from "../../../.swarm/contracts/types";
import { ActuatorCircuitBreaker } from "../policy/safety-chord-engine";
import { STEADYGATE_V6_CONFIG } from "../../config/steadygate.config";

/**
 * Subagent S10 & Wave 5 Stage 5 — Authenticated Local LAN Hardware Bridge
 * Executes 100% offline local LAN appliance actuation with:
 *  - HMAC-SHA256 request signing (X-SteadyGate-Signature, X-SteadyGate-Timestamp, X-SteadyGate-Nonce)
 *  - +-5,000 ms replay window and nonce cache
 *  - 800 ms AbortController timeout, Tier 3 Two-Step Safety Chord verification, and 3-strike Circuit Breaker
 */

const DEFAULT_LAN_HMAC_SECRET =
  process.env.STEADYGATE_LAN_HMAC_SECRET || "steadygate-v6-local-lan-hmac-key";
const usedNonces = new Map<string, number>();

export function computeLanBridgeHmacSignature(
  payloadJson: string,
  timestampMs: number | string,
  nonce: string,
  secretKey: string = DEFAULT_LAN_HMAC_SECRET
): string {
  const canonical = `${timestampMs}.${nonce}.${payloadJson}`;
  return crypto.createHmac("sha256", secretKey).update(canonical).digest("hex");
}

export function buildSignedLanBridgeHeaders(
  payloadJson: string,
  options?: {
    timestampMs?: number;
    nonce?: string;
    secretKey?: string;
  }
): Record<string, string> {
  const ts = options?.timestampMs ?? Date.now();
  const nonce =
    options?.nonce ?? `${ts.toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
  const sig = computeLanBridgeHmacSignature(payloadJson, ts, nonce, options?.secretKey);
  return {
    "Content-Type": "application/json",
    "X-SteadyGate-Timestamp": String(ts),
    "X-SteadyGate-Nonce": nonce,
    "X-SteadyGate-Signature": sig,
  };
}

export function verifyLanBridgeHmacRequest(input: {
  payloadJson: string;
  signatureHeader?: string | null;
  timestampHeader?: string | null;
  nonceHeader?: string | null;
  nowMs?: number;
  secretKey?: string;
}): {
  valid: boolean;
  status: 200 | 401;
  reason: string;
} {
  const nowMs = input.nowMs ?? Date.now();
  const maxSkewMs = STEADYGATE_V6_CONFIG.stage5Actuation.hmacReplayWindowMs.value;

  if (!input.signatureHeader || !input.timestampHeader || !input.nonceHeader) {
    return { valid: false, status: 401, reason: "MISSING_HMAC_HEADERS" };
  }

  const tsNum = Number(input.timestampHeader);
  if (!Number.isFinite(tsNum) || Math.abs(nowMs - tsNum) > maxSkewMs) {
    return { valid: false, status: 401, reason: "HMAC_TIMESTAMP_OUT_OF_WINDOW" };
  }

  // Prune expired nonces and reject replayed nonces
  for (const [n, seenAt] of usedNonces.entries()) {
    if (nowMs - seenAt > maxSkewMs * 2) {
      usedNonces.delete(n);
    }
  }
  if (usedNonces.has(input.nonceHeader)) {
    return { valid: false, status: 401, reason: "HMAC_NONCE_REPLAY_DETECTED" };
  }

  const expected = computeLanBridgeHmacSignature(
    input.payloadJson,
    tsNum,
    input.nonceHeader,
    input.secretKey
  );
  const sigBuf = Buffer.from(input.signatureHeader, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, status: 401, reason: "HMAC_SIGNATURE_MISMATCH" };
  }

  usedNonces.set(input.nonceHeader, nowMs);
  return { valid: true, status: 200, reason: "HMAC_VERIFIED" };
}

export function clearLanBridgeNonceCache(): void {
  usedNonces.clear();
}

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
      const payloadBody = JSON.stringify({
        deviceId: device.id,
        command,
        mqttTopic: device.mqttTopic,
        espPin: device.espPin,
      });
      const res = await fetch(device.lanEndpointUrl, {
        method: "POST",
        headers: buildSignedLanBridgeHeaders(payloadBody),
        body: payloadBody,
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
