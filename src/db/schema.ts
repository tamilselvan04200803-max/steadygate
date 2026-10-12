import { pgTable, text, timestamp, boolean, doublePrecision, integer } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  condition: text("condition").notNull().default("Parkinson's Disease"),
  f0Hz: doublePrecision("f0_hz").notNull().default(5.2),
  amplitudeRms: doublePrecision("amplitude_rms").notNull().default(0.045),
  notchBandwidthHz: doublePrecision("notch_bandwidth_hz").notNull().default(2.0),
  attentionFloor: doublePrecision("attention_floor").notNull().default(0.60),
  adaptiveDwellFactor: doublePrecision("adaptive_dwell_factor").notNull().default(1.30),
  medicationPhase: text("medication_phase").notNull().default("ON Phase"),
  palmScale: doublePrecision("palm_scale").notNull().default(1.0),
  fingerFlexibility: doublePrecision("finger_flexibility").notNull().default(1.0),
  personalizedPrototypes: text("personalized_prototypes"),
  lastCalibratedAt: timestamp("last_calibrated_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appliances = pgTable("appliances", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  riskTier: text("risk_tier").notNull().default("R0"),
  powerState: text("power_state").notNull().default("OFF"),
  targetValue: integer("target_value").notNull().default(0),
  unit: text("unit").notNull().default("%"),
  location: text("location").notNull().default("Living Room"),
  requiresHandshake: boolean("requires_handshake").notNull().default(false),
  hazardDescription: text("hazard_description").notNull().default(""),
  iconName: text("icon_name").notNull().default("Lightbulb"),
  fanSpeed: integer("fan_speed").notNull().default(0),
  temperature: doublePrecision("temperature").notNull().default(24.0),
  airRpm: integer("air_rpm").notNull().default(0),
  airflowCfm: integer("airflow_cfm").notNull().default(0),
  brightness: integer("brightness").notNull().default(0),
  activeWattage: doublePrecision("active_wattage").notNull().default(0.0),
  espPin: integer("esp_pin").notNull().default(12),
  mqttTopic: text("mqtt_topic").notNull().default("home/device"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const actuationLogs = pgTable("actuation_logs", {
  id: text("id").primaryKey(),
  applianceId: text("appliance_id").notNull(),
  applianceName: text("appliance_name").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  gesture: text("gesture").notNull(),
  targetCommand: text("target_command").notNull(),
  riskTier: text("risk_tier").notNull(),
  intentScore: doublePrecision("intent_score").notNull(),
  posterior: doublePrecision("posterior").notNull(),
  margin: doublePrecision("margin").notNull(),
  attention: doublePrecision("attention").notNull(),
  stabilityRaw: doublePrecision("stability_raw").notNull(),
  stabilityNorm: doublePrecision("stability_norm").notNull(),
  sceneQuality: doublePrecision("scene_quality").notNull(),
  contextPrior: doublePrecision("context_prior").notNull(),
  dwellTimeMs: integer("dwell_time_ms").notNull(),
  dwellRequiredMs: integer("dwell_required_ms").notNull(),
  baselineMode: text("baseline_mode").notNull().default("STEADYGATE"),
  status: text("status").notNull(),
  rejectCode: text("reject_code").notNull().default("NONE"),
  wasReAttempt: boolean("was_re_attempt").notNull().default(false),
  calibratedNudge: boolean("calibrated_nudge").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const calibrationEvents = pgTable("calibration_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  previousAmplitude: doublePrecision("previous_amplitude").notNull(),
  newAmplitude: doublePrecision("new_amplitude").notNull(),
  f0Hz: doublePrecision("f0_hz").notNull(),
  reason: text("reason").notNull(),
  triggerLogId: text("trigger_log_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentFindings = pgTable("agent_findings", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  agentName: text("agent_name").notNull(),
  modelId: text("model_id").notNull(),
  severity: text("severity").notNull(), // CRITICAL | HIGH | MEDIUM | LOW | INFO
  category: text("category").notNull(),
  title: text("title").notNull(),
  symptom: text("symptom").notNull(),
  rootCause: text("root_cause").notNull(),
  evidence: text("evidence").notNull(), // JSON
  fixSteps: text("fix_steps").notNull(), // JSON array of strings
  codeHints: text("code_hints").notNull().default(""), // JSON array
  affectedModules: text("affected_modules").notNull().default(""), // JSON array
  confidence: doublePrecision("confidence").notNull().default(0.85),
  status: text("status").notNull().default("OPEN"), // OPEN | ACKNOWLEDGED | RESOLVED | IGNORED
  runId: text("run_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

/**
 * Frontend runtime telemetry — the vision pipeline reports its true state here
 * (model load, delegate, fps, detection rate, scene luminance/contrast/clutter,
 * gesture vote stability, JS errors). Agents read this to see the browser.
 */
export const runtimeTelemetry = pgTable("runtime_telemetry", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  source: text("source").notNull().default("vision"), // vision | ui | api
  payload: text("payload").notNull(), // JSON
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentRuns = pgTable("agent_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull().default("CONTINUOUS"), // CONTINUOUS | MANUAL | EVENT
  status: text("status").notNull().default("RUNNING"), // RUNNING | COMPLETED | FAILED
  agentsInvoked: integer("agents_invoked").notNull().default(0),
  findingsCount: integer("findings_count").notNull().default(0),
  criticalCount: integer("critical_count").notNull().default(0),
  highCount: integer("high_count").notNull().default(0),
  summary: text("summary").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});
