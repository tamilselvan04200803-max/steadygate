export type AgentSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
export type FindingStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED" | "IGNORED";
export type AgentRunStatus = "RUNNING" | "COMPLETED" | "FAILED";
export type AgentRunTrigger = "CONTINUOUS" | "MANUAL" | "EVENT" | "BOOT";

export type AgentScope =
  | "VISION_GESTURE"
  | "SIGNAL_TREMOR"
  | "INTENT_GATE"
  | "IOT_MQTT"
  | "SAFETY_RISK"
  | "PERSONALIZATION"
  | "SYSTEM_HEALTH"
  | "FRONTEND_RUNTIME"
  | "SCENE_ROBUSTNESS"
  | "INTENT_CONTINUITY"
  | "API_BACKEND"
  | "ORCHESTRATOR";

export interface TelemetrySample {
  sessionId: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface ApiProbe {
  route: string;
  method: string;
  status: number;
  ok: boolean;
  latencyMs: number;
  error?: string;
  bodyOk?: boolean;
}

export interface AgentModelSpec {
  id: string;
  name: string;
  family: string;
  specialty: string;
  version: string;
  trainingScope: string[];
  confidenceFloor: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  scope: AgentScope;
  model: AgentModelSpec;
  color: string;
  icon: string;
  description: string;
}

export interface AgentFinding {
  id: string;
  agentId: string;
  agentName: string;
  modelId: string;
  severity: AgentSeverity;
  category: string;
  title: string;
  symptom: string;
  rootCause: string;
  evidence: string; // JSON
  fixSteps: string; // JSON array
  codeHints: string; // JSON array
  affectedModules: string; // JSON array
  confidence: number;
  status: FindingStatus;
  runId: string;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface AgentRun {
  id: string;
  trigger: AgentRunTrigger;
  status: AgentRunStatus;
  agentsInvoked: number;
  findingsCount: number;
  criticalCount: number;
  highCount: number;
  summary: string;
  durationMs: number;
  createdAt: string;
  completedAt?: string | null;
}

export interface AgentTraceStep {
  agentId: string;
  agentName: string;
  modelId: string;
  phase: "OBSERVE" | "REASON" | "DIAGNOSE" | "PRESCRIBE" | "ESCALATE";
  message: string;
  ts: string;
  durationMs: number;
}

export interface AnalysisSnapshot {
  appliances: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  recentLogs: Array<Record<string, unknown>>;
  calibrationEvents: Array<Record<string, unknown>>;
  telemetry: TelemetrySample[];
  apiProbes: ApiProbe[];
  system: {
    totalAppliances: number;
    activeAppliances: number;
    totalPowerW: number;
    rejectRate: number;
    actuatedCount: number;
    rejectedCount: number;
    handshakePendingCount: number;
    avgIntentScore: number;
    avgStabilityNorm: number;
    avgAttention: number;
    r2DevicesOn: number;
    tremorUsers: number;
    lastActuationAgeMs: number | null;
  };
}

export interface AgentAnalysisResult {
  findings: Omit<AgentFinding, "id" | "runId" | "createdAt" | "status" | "resolvedAt">[];
  traces: AgentTraceStep[];
}
