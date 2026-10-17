# SteadyGate v6.0 — Deletion Manifest (Invariant I7)

Every file listed below satisfied all 5 criteria of the **Wave 0 Deletion Safety Protocol** before removal via `git rm`:
1. Zero static, dynamic, or string references across active `src/`, `steadygate/`, `tests/`, `package.json` scripts, and Next.js UI routes;
2. Not imported or read by any of the 6 verification suites (`gesture-robustness.test.ts`, `adversarial-challenger-1.ts`, `adversarial-challenger-2.test.ts`, `global-v4-adversarial.test.ts`, `pytest`);
3. Contained zero user calibration or persistent storage records;
4. Removed via `git rm` and documented below;
5. `./node_modules/.bin/tsc --noEmit` and all 6 verification suites passed immediately after removal.

| Deleted File Path | Reason for Removal | Proof of Non-Reference |
| :--- | :--- | :--- |
| `src/app/api/agents/route.ts` | Legacy v1/v2 "15-employee roleplay" API route superseded by `/api/ai-agent` (`src/app/api/ai-agent/route.ts`) | `0` references across `src/app/page.tsx`, `src/components/*`, `tests/*`, `steadygate/*` |
| `src/app/api/benchmark/route.ts` | Legacy v1 synthetic benchmark route superseded by `/api/admin-train` (`src/app/api/admin-train/route.ts`) | `0` references across `src/`, `tests/`, `steadygate/` |
| `src/lib/agent-brain-runtime.ts` | Obsolete v2 roleplay agent runtime only referenced by `src/lib/agent-brain.ts` | `0` active references outside deleted `agent-brain.ts` |
| `src/lib/agent-brain.ts` | Obsolete v2 roleplay agent coordinator only referenced by `src/app/api/agents/route.ts` | `0` active references outside deleted `src/app/api/agents/route.ts` |
| `src/lib/agent-roster.ts` | Obsolete v1/v2 15-employee roleplay roster | `0` active references across `src/components/*`, `src/app/page.tsx`, `tests/*` |
| `src/lib/agent-types.ts` | Obsolete v1/v2 roleplay agent type definitions | `0` active references across `src/components/*`, `src/app/page.tsx`, `tests/*` |
