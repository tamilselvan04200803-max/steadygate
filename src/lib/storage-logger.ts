import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const LOGS_DIR = path.join(REPO_ROOT, "logs");
const STORAGE_DIR = path.join(REPO_ROOT, "storage");

function ensureDirs(): void {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

export function appendJsonlLog(fileName: string, record: Record<string, unknown>): void {
  try {
    ensureDirs();
    const filePath = path.join(LOGS_DIR, fileName);
    const payload = {
      timestampIso: new Date().toISOString(),
      ...record,
    };
    fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", { encoding: "utf-8" });
  } catch (err) {
    console.error(`Failed to append JSONL log to ${fileName}:`, err);
  }
}

export function readJsonStorage<T>(fileName: string, fallback: T): T {
  try {
    ensureDirs();
    const filePath = path.join(STORAGE_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, { encoding: "utf-8" });
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(fileName: string, data: unknown): void {
  try {
    ensureDirs();
    const filePath = path.join(STORAGE_DIR, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: "utf-8" });
  } catch (err) {
    console.error(`Failed to write JSON storage to ${fileName}:`, err);
  }
}

export function upsertPersonalizedUserStorage(userRecord: Record<string, unknown>): void {
  const existing = readJsonStorage<{
    updatedAt: string;
    users: Record<string, Record<string, unknown>>;
  }>("users_personalized.json", {
    updatedAt: new Date().toISOString(),
    users: {},
  });

  const userId = String(userRecord.id || "unknown_user");
  const prev = existing.users[userId] || {};
  const merged = {
    ...prev,
    ...userRecord,
    updatedAt: new Date().toISOString(),
    observationSnapshotsCount: Number(prev.observationSnapshotsCount || 0) + 1,
  };
  existing.users[userId] = merged;
  existing.updatedAt = new Date().toISOString();

  writeJsonStorage("users_personalized.json", existing);
  writeJsonStorage(`user_${userId}_profile.json`, merged);
}

export function saveAppliancesStorageSnapshot(appliancesList: unknown[]): void {
  writeJsonStorage("appliance_states.json", {
    updatedAt: new Date().toISOString(),
    appliances: appliancesList,
  });
}

export function readRecentJsonlLines(fileName: string, limit = 50): Record<string, unknown>[] {
  try {
    ensureDirs();
    const filePath = path.join(LOGS_DIR, fileName);
    if (!fs.existsSync(filePath)) return [];
    const lines = fs
      .readFileSync(filePath, { encoding: "utf-8" })
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>;
        } catch {
          return { raw: l };
        }
      });
  } catch {
    return [];
  }
}
