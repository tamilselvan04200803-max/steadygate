import { RecognizedGesture } from "./types";

export interface DefaultGestureApplianceBinding {
  gesture: RecognizedGesture;
  icon: string;
  label: string;
  defaultApplianceId: string;
  defaultApplianceName: string;
  command: string;
  requiredHoldMs: number;
  amperageRating: string;
  isHighAmpere: boolean;
  ergonomicDifficulty: "EASY_RESTING" | "MODERATE";
  actionSummary: string;
}

/**
 * Default Dynamic Gesture-to-Appliance Bindings:
 * - High-ampere appliances (Space Heater 9.1A/2000W, Water Boiler 13.6A/3000W, AC 5.7A/1250W)
 *   are bound to easy, low-fatigue resting postures (FIST, THUMBS_UP, CALL_ME) with longer
 *   sustained hold times (2200ms - 2600ms) to guarantee intentionality without hand strain.
 * - Low-ampere appliances (Fan 0.2A, Lamp 0.05A, Blinds 0.07A) use quick holds (800ms - 1100ms).
 * - Users can dynamically customize any binding at runtime.
 */
export const DEFAULT_GESTURE_APPLIANCE_BINDINGS: Record<
  RecognizedGesture,
  DefaultGestureApplianceBinding
> = {
  FIST: {
    gesture: "FIST",
    icon: "✊",
    label: "Closed Fist (Easy Long-Hold)",
    defaultApplianceId: "heater_radiant",
    defaultApplianceName: "Radiant Quartz Space Heater",
    command: "TOGGLE_POWER",
    requiredHoldMs: 2500,
    amperageRating: "9.1 A (2000 W)",
    isHighAmpere: true,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Closed Fist for 2.5s to turn High-Ampere Space Heater ON / OFF",
  },
  OPEN_PALM: {
    gesture: "OPEN_PALM",
    icon: "✋",
    label: "Open Palm",
    defaultApplianceId: "fan_table",
    defaultApplianceName: "Study Turbo Breeze Fan",
    command: "TOGGLE_FAN_POWER",
    requiredHoldMs: 800,
    amperageRating: "0.2 A (42 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Open Palm for 0.8s to turn Study Turbo Breeze Fan ON (Speed 2) / OFF",
  },
  THUMBS_UP: {
    gesture: "THUMBS_UP",
    icon: "👍",
    label: "Thumbs Up (Easy Long-Hold)",
    defaultApplianceId: "ac_living",
    defaultApplianceName: "Living Room Dual-Inverter AC",
    command: "TOGGLE_POWER",
    requiredHoldMs: 2200,
    amperageRating: "5.7 A (1250 W)",
    isHighAmpere: true,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Thumbs Up for 2.2s to turn High-Ampere Living Room AC ON (22°C) / OFF",
  },
  CALL_ME: {
    gesture: "CALL_ME",
    icon: "🤙",
    label: "Call-Me / Shaka (Easy Long-Hold)",
    defaultApplianceId: "geyser_bath",
    defaultApplianceName: "Smart Water Boiler / Geyser",
    command: "TOGGLE_POWER",
    requiredHoldMs: 2600,
    amperageRating: "13.6 A (3000 W)",
    isHighAmpere: true,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Call-Me posture for 2.6s to turn High-Ampere 3000W Water Geyser ON / OFF",
  },
  POINTING_UP: {
    gesture: "POINTING_UP",
    icon: "☝️",
    label: "Pointing Up",
    defaultApplianceId: "lamp_desk",
    defaultApplianceName: "Study Reading Lamp",
    command: "TOGGLE_POWER",
    requiredHoldMs: 800,
    amperageRating: "0.05 A (12 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Pointing Up for 0.8s to turn Study Reading Lamp ON (85% Lux) / OFF",
  },
  VICTORY: {
    gesture: "VICTORY",
    icon: "✌️",
    label: "Victory (2 Fingers)",
    defaultApplianceId: "tv_ambient",
    defaultApplianceName: 'Living Room 65" Smart Display',
    command: "TOGGLE_POWER",
    requiredHoldMs: 1100,
    amperageRating: "0.5 A (110 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "MODERATE",
    actionSummary: "Hold Victory for 1.1s to turn Smart Display TV ON / OFF",
  },
  PINCH: {
    gesture: "PINCH",
    icon: "👌",
    label: "Thumb-Index Pinch",
    defaultApplianceId: "blinds_window",
    defaultApplianceName: "Motorized Privacy Blinds",
    command: "TOGGLE_POWER",
    requiredHoldMs: 1000,
    amperageRating: "0.07 A (15 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "MODERATE",
    actionSummary: "Hold Pinch for 1.0s to Open / Close Motorized Privacy Blinds",
  },
  THREE_FINGERS: {
    gesture: "THREE_FINGERS",
    icon: "🤟",
    label: "Three Fingers",
    defaultApplianceId: "fan_table",
    defaultApplianceName: "Study Turbo Breeze Fan",
    command: "CYCLE_FAN_SPEED",
    requiredHoldMs: 900,
    amperageRating: "0.2 A (42 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "MODERATE",
    actionSummary: "Hold Three Fingers for 0.9s to cycle Fan Speed (1 → 2 → 3 → 4)",
  },
  FOUR_FINGERS: {
    gesture: "FOUR_FINGERS",
    icon: "🖖",
    label: "Four Fingers",
    defaultApplianceId: "door_deadbolt",
    defaultApplianceName: "Main Entrance Deadbolt Lock",
    command: "TOGGLE_POWER",
    requiredHoldMs: 1800,
    amperageRating: "0.04 A (8 W)",
    isHighAmpere: false,
    ergonomicDifficulty: "MODERATE",
    actionSummary: "Hold Four Fingers for 1.8s to Lock / Unlock Main Entrance Deadbolt",
  },
  THUMBS_DOWN: {
    gesture: "THUMBS_DOWN",
    icon: "👎",
    label: "Thumbs Down (Quick Cutoff)",
    defaultApplianceId: "heater_radiant",
    defaultApplianceName: "Radiant Quartz Space Heater",
    command: "SET_POWER_OFF",
    requiredHoldMs: 900,
    amperageRating: "9.1 A (2000 W)",
    isHighAmpere: true,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "Hold Thumbs Down for 0.9s to immediately turn OFF High-Ampere Heater",
  },
  UNKNOWN: {
    gesture: "UNKNOWN",
    icon: "❓",
    label: "Neutral / Resting",
    defaultApplianceId: "fan_table",
    defaultApplianceName: "None (Idle)",
    command: "NONE",
    requiredHoldMs: 1000,
    amperageRating: "0 A",
    isHighAmpere: false,
    ergonomicDifficulty: "EASY_RESTING",
    actionSummary: "No active gesture detected",
  },
};

export const DEFAULT_GESTURE_APPLIANCE_MAP: DefaultGestureApplianceBinding[] = [
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.FIST,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.OPEN_PALM,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.THUMBS_UP,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.CALL_ME,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.POINTING_UP,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.VICTORY,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.PINCH,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.THREE_FINGERS,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.FOUR_FINGERS,
  DEFAULT_GESTURE_APPLIANCE_BINDINGS.THUMBS_DOWN,
];

export function getDefaultBindingForGesture(
  gesture: string,
  customBindings?: DefaultGestureApplianceBinding[]
): DefaultGestureApplianceBinding | null {
  if (customBindings && customBindings.length > 0) {
    const found = customBindings.find((b) => b.gesture === gesture);
    if (found) return found;
  }
  const key = gesture as RecognizedGesture;
  if (!key || key === "UNKNOWN" || !(key in DEFAULT_GESTURE_APPLIANCE_BINDINGS)) {
    return null;
  }
  return DEFAULT_GESTURE_APPLIANCE_BINDINGS[key];
}

export function getApplianceGestureBadge(
  applianceId: string,
  customBindings?: DefaultGestureApplianceBinding[]
): string {
  const list = customBindings && customBindings.length > 0 ? customBindings : DEFAULT_GESTURE_APPLIANCE_MAP;
  const match = list.find((b) => b.defaultApplianceId === applianceId && b.command !== "SET_POWER_OFF");
  if (match) {
    return `${match.icon} ${match.gesture} (${(match.requiredHoldMs / 1000).toFixed(1)}s hold)`;
  }
  return APPLIANCE_DEFAULT_GESTURE_LABEL[applianceId] || "✋ OPEN_PALM";
}

export const APPLIANCE_DEFAULT_GESTURE_LABEL: Record<string, string> = {
  heater_radiant: "✊ FIST (2.5s Long-Hold · 9.1A Heater ON/OFF)",
  fan_table: "✋ OPEN_PALM (0.8s Hold · Turn Fan ON/OFF)",
  ac_living: "👍 THUMBS_UP (2.2s Long-Hold · 5.7A AC ON/OFF)",
  geyser_bath: "🤙 CALL_ME (2.6s Long-Hold · 13.6A Geyser ON/OFF)",
  lamp_desk: "☝️ POINTING_UP (0.8s Hold · Turn Lamp ON/OFF)",
  tv_ambient: "✌️ VICTORY (1.1s Hold · Turn TV ON/OFF)",
  blinds_window: "👌 PINCH (1.0s Hold · Open/Close Blinds)",
  door_deadbolt: "🖖 FOUR_FINGERS (1.8s Hold · Lock/Unlock Door)",
};
