import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

const SCHEMA_BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  condition TEXT NOT NULL DEFAULT 'Parkinson''s Disease',
  f0_hz DOUBLE PRECISION NOT NULL DEFAULT 5.2,
  amplitude_rms DOUBLE PRECISION NOT NULL DEFAULT 0.045,
  notch_bandwidth_hz DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  attention_floor DOUBLE PRECISION NOT NULL DEFAULT 0.60,
  adaptive_dwell_factor DOUBLE PRECISION NOT NULL DEFAULT 1.30,
  medication_phase TEXT NOT NULL DEFAULT 'ON Phase',
  palm_scale DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  finger_flexibility DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  personalized_prototypes TEXT,
  last_calibrated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appliances (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  risk_tier TEXT NOT NULL DEFAULT 'R0',
  power_state TEXT NOT NULL DEFAULT 'OFF',
  target_value INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT '%',
  location TEXT NOT NULL DEFAULT 'Living Room',
  requires_handshake BOOLEAN NOT NULL DEFAULT FALSE,
  hazard_description TEXT NOT NULL DEFAULT '',
  icon_name TEXT NOT NULL DEFAULT 'Lightbulb',
  fan_speed INTEGER NOT NULL DEFAULT 0,
  temperature DOUBLE PRECISION NOT NULL DEFAULT 24.0,
  air_rpm INTEGER NOT NULL DEFAULT 0,
  airflow_cfm INTEGER NOT NULL DEFAULT 0,
  brightness INTEGER NOT NULL DEFAULT 0,
  active_wattage DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  esp_pin INTEGER NOT NULL DEFAULT 12,
  mqtt_topic TEXT NOT NULL DEFAULT 'home/device',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS actuation_logs (
  id TEXT PRIMARY KEY,
  appliance_id TEXT NOT NULL,
  appliance_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  gesture TEXT NOT NULL,
  target_command TEXT NOT NULL,
  risk_tier TEXT NOT NULL,
  intent_score DOUBLE PRECISION NOT NULL,
  posterior DOUBLE PRECISION NOT NULL,
  margin DOUBLE PRECISION NOT NULL,
  attention DOUBLE PRECISION NOT NULL,
  stability_raw DOUBLE PRECISION NOT NULL,
  stability_norm DOUBLE PRECISION NOT NULL,
  scene_quality DOUBLE PRECISION NOT NULL,
  context_prior DOUBLE PRECISION NOT NULL,
  dwell_time_ms INTEGER NOT NULL,
  dwell_required_ms INTEGER NOT NULL,
  baseline_mode TEXT NOT NULL DEFAULT 'STEADYGATE',
  status TEXT NOT NULL,
  reject_code TEXT NOT NULL DEFAULT 'NONE',
  was_re_attempt BOOLEAN NOT NULL DEFAULT FALSE,
  calibrated_nudge BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calibration_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  previous_amplitude DOUBLE PRECISION NOT NULL,
  new_amplitude DOUBLE PRECISION NOT NULL,
  f0_hz DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  trigger_log_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_findings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  symptom TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  evidence TEXT NOT NULL,
  fix_steps TEXT NOT NULL,
  code_hints TEXT NOT NULL DEFAULT '',
  affected_modules TEXT NOT NULL DEFAULT '',
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.85,
  status TEXT NOT NULL DEFAULT 'OPEN',
  run_id TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS runtime_telemetry (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'vision',
  payload TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL DEFAULT 'CONTINUOUS',
  status TEXT NOT NULL DEFAULT 'RUNNING',
  agents_invoked INTEGER NOT NULL DEFAULT 0,
  findings_count INTEGER NOT NULL DEFAULT 0,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
`;

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaPgliteInstance?: PGlite;
  __arenaPgliteInitPromise?: Promise<void>;
  __arenaDrizzleDb?: ReturnType<typeof drizzlePg>;
};

function createDbInstance(): ReturnType<typeof drizzlePg> {
  if (globalForDb.__arenaDrizzleDb) {
    return globalForDb.__arenaDrizzleDb;
  }

  if (databaseUrl && !databaseUrl.startsWith("pglite:")) {
    const pool =
      globalForDb.__arenaNextJsPostgresqlPool ??
      new Pool({
        connectionString: databaseUrl,
      });
    globalForDb.__arenaNextJsPostgresqlPool = pool;
    const instance = drizzlePg(pool);
    globalForDb.__arenaDrizzleDb = instance;
    return instance;
  }

  const pglite = globalForDb.__arenaPgliteInstance ?? new PGlite();
  globalForDb.__arenaPgliteInstance = pglite;
  if (!globalForDb.__arenaPgliteInitPromise) {
    globalForDb.__arenaPgliteInitPromise = pglite
      .exec(SCHEMA_BOOTSTRAP_SQL)
      .then(() => undefined)
      .catch((err) => {
        console.error("PGlite schema bootstrap error:", err);
      });
  }
  const instance = drizzlePglite(pglite) as unknown as ReturnType<typeof drizzlePg>;
  globalForDb.__arenaDrizzleDb = instance;
  return instance;
}

export const db = createDbInstance();

export async function ensureDbReady(): Promise<void> {
  if (globalForDb.__arenaPgliteInitPromise) {
    await globalForDb.__arenaPgliteInitPromise;
  } else if (globalForDb.__arenaPgliteInstance) {
    globalForDb.__arenaPgliteInitPromise = globalForDb.__arenaPgliteInstance
      .exec(SCHEMA_BOOTSTRAP_SQL)
      .then(() => undefined);
    await globalForDb.__arenaPgliteInitPromise;
  }
}

export const pool = globalForDb.__arenaNextJsPostgresqlPool ?? {
  end: async () => {
    if (globalForDb.__arenaPgliteInstance) {
      await globalForDb.__arenaPgliteInstance.close();
    }
  },
};
