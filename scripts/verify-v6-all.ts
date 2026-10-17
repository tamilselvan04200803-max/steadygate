/**
 * SteadyGate v6.0 — Single-Command Full Verification Runner (`scripts/verify-v6-all.ts`)
 * --------------------------------------------------------------------------------------
 * Executes:
 *  1. TypeScript strict typecheck (`npx tsc --noEmit`)
 *  2. Out-of-Sample Calibration & Held-Out Verification (`npx tsx scripts/fit-v6-calibration.ts`)
 *  3. Gesture Robustness & HaGRID 500 Real-Replay Suite (`npx tsx tests/gesture-robustness.test.ts`)
 *  4. Challenger 1 Adversarial Object-Grasp & Vision Suite (`npx tsx tests/adversarial-challenger-1.ts`)
 *  5. Challenger 2 Adversarial Tremor f0 & Admin Trainer Suite (`npx tsx tests/adversarial-challenger-2.test.ts`)
 *  6. Global v4/v5/v6 Multi-Seed Adversarial Suite G1-G11 (`npx tsx tests/global-v4-adversarial.test.ts`)
 *  7. Python Digital Twin, Flight Recorder, Policy & Chaos Suite (`python3 -m pytest -v`)
 */

import { execSync } from "child_process";

interface VerificationStep {
  id: string;
  label: string;
  command: string;
}

const STEPS: VerificationStep[] = [
  {
    id: "STEP_1_TSC",
    label: "TypeScript Strict Compiler Check (tsc --noEmit)",
    command: "npx tsc --noEmit",
  },
  {
    id: "STEP_2_CALIBRATION",
    label: "Out-of-Sample Calibration & Held-Out Split Audit (fit-v6-calibration.ts)",
    command: "npx tsx scripts/fit-v6-calibration.ts",
  },
  {
    id: "STEP_3_ROBUSTNESS",
    label: "Gesture Robustness & Real HaGRID 500 Benchmark (26 checks)",
    command: "npx tsx tests/gesture-robustness.test.ts",
  },
  {
    id: "STEP_4_CHALLENGER_1",
    label: "Challenger 1 Adversarial Object-Grasp & Vision Suite (18 checks)",
    command: "npx tsx tests/adversarial-challenger-1.ts",
  },
  {
    id: "STEP_5_CHALLENGER_2",
    label: "Challenger 2 Adversarial Tremor f0 & Admin Trainer Suite (70 checks)",
    command: "npx tsx tests/adversarial-challenger-2.test.ts",
  },
  {
    id: "STEP_6_GLOBAL_G1_G11",
    label: "Global Multi-Seed Adversarial Suite Batteries G1-G11 (41 checks)",
    command: "npx tsx tests/global-v4-adversarial.test.ts",
  },
  {
    id: "STEP_7_PYTEST",
    label: "Python Digital Twin, Flight Recorder & Chaos Suite (26 tests)",
    command: process.platform === "win32" ? "py -m pytest -v" : "python3 -m pytest -v",
  },
];

function main() {
  console.log("================================================================================");
  console.log("  STEADYGATE v6.0 — PRODUCTION-LOCKED FLAGSHIP VERIFICATION SUITE");
  console.log("================================================================================\n");

  const results: Array<{ id: string; label: string; elapsedMs: number; ok: boolean }> = [];

  for (const step of STEPS) {
    const t0 = performance.now();
    process.stdout.write(`▶ Running [${step.id}] ${step.label} ... `);
    try {
      execSync(step.command, { stdio: "pipe", encoding: "utf8" });
      const elapsedMs = Math.round(performance.now() - t0);
      console.log(`PASS (${elapsedMs} ms)`);
      results.push({ id: step.id, label: step.label, elapsedMs, ok: true });
    } catch (err: unknown) {
      const elapsedMs = Math.round(performance.now() - t0);
      console.log(`FAIL (${elapsedMs} ms)`);
      const stdout = (err as { stdout?: string })?.stdout || "";
      const stderr = (err as { stderr?: string })?.stderr || "";
      console.error(stdout);
      console.error(stderr);
      results.push({ id: step.id, label: step.label, elapsedMs, ok: false });
      process.exit(1);
    }
  }

  console.log("\n================================================================================");
  console.log(
    `  VERDICT: ALL ${results.length}/${ STEPS.length } VERIFICATION SUITES PASSED (100% GREEN)`
  );
  console.log("================================================================================");
}

main();
