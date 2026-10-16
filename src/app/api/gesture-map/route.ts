import { NextResponse } from "next/server";
import {
  DEFAULT_GESTURE_APPLIANCE_MAP,
  DefaultGestureApplianceBinding,
} from "@/lib/default-gesture-map";
import { readJsonStorage, writeJsonStorage, appendJsonlLog } from "@/lib/storage-logger";

const STORAGE_FILE = "gesture_mappings.json";

export async function GET() {
  try {
    const saved = readJsonStorage<{
      updatedAt: string;
      mappings: DefaultGestureApplianceBinding[];
    }>(STORAGE_FILE, {
      updatedAt: new Date().toISOString(),
      mappings: DEFAULT_GESTURE_APPLIANCE_MAP,
    });

    return NextResponse.json({
      success: true,
      mappings:
        Array.isArray(saved.mappings) && saved.mappings.length > 0
          ? saved.mappings
          : DEFAULT_GESTURE_APPLIANCE_MAP,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error("GET /api/gesture-map error:", error);
    return NextResponse.json({
      success: true,
      mappings: DEFAULT_GESTURE_APPLIANCE_MAP,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { mappings, resetToDefault } = body;

    if (resetToDefault) {
      const payload = {
        updatedAt: new Date().toISOString(),
        mappings: DEFAULT_GESTURE_APPLIANCE_MAP,
      };
      writeJsonStorage(STORAGE_FILE, payload);
      appendJsonlLog("user_observations.jsonl", {
        event: "gesture_mappings_reset",
        mappingsCount: DEFAULT_GESTURE_APPLIANCE_MAP.length,
      });
      return NextResponse.json({
        success: true,
        mappings: DEFAULT_GESTURE_APPLIANCE_MAP,
        savedTo: `storage/${STORAGE_FILE}`,
      });
    }

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return NextResponse.json(
        { success: false, error: "Valid mappings array is required" },
        { status: 400 }
      );
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      mappings,
    };
    writeJsonStorage(STORAGE_FILE, payload);
    appendJsonlLog("user_observations.jsonl", {
      event: "custom_gesture_mapping_saved",
      mappings: mappings.map((m: DefaultGestureApplianceBinding) => ({
        gesture: m.gesture,
        applianceId: m.defaultApplianceId,
        applianceName: m.defaultApplianceName,
        command: m.command,
        requiredHoldMs: m.requiredHoldMs,
      })),
    });

    return NextResponse.json({
      success: true,
      mappings,
      savedTo: `storage/${STORAGE_FILE}`,
    });
  } catch (error) {
    console.error("POST /api/gesture-map error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to save custom gesture mappings" },
      { status: 500 }
    );
  }
}
