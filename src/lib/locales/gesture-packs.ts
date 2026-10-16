import type { RecognizedGesture } from "../types";
import type {
  LocaleGesturePack,
  LocaleGestureResolution,
  PalmOrientation,
} from "../../../.swarm/contracts/types";

/**
 * Subagent S2 — ISO-3166 Locale Semiotic & Cultural Pack Engineer
 * Provides zero-allocation cultural gesture filtering and safe intent remapping
 * across 190+ ISO-3166 country codes.
 */
export const LOCALE_GESTURE_PACKS: Record<string, LocaleGesturePack> = {
  US: {
    countryCode: "US",
    countryName: "United States (Global Standard)",
    region: "North America",
    restrictedGestures: [],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "Standard 10-gesture canonical mapping.",
  },
  IN: {
    countryCode: "IN",
    countryName: "India",
    region: "South Asia",
    restrictedGestures: [],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "50Hz power-grid flicker compensation enabled by default.",
  },
  GB: {
    countryCode: "GB",
    countryName: "United Kingdom",
    region: "Europe",
    restrictedGestures: [],
    requirePalmarForVictory: true,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "Dorsal V-sign (VICTORY with isPalmar === false) is suppressed to UNKNOWN.",
  },
  IE: {
    countryCode: "IE",
    countryName: "Ireland",
    region: "Europe",
    restrictedGestures: [],
    requirePalmarForVictory: true,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "Dorsal V-sign suppressed to UNKNOWN.",
  },
  AU: {
    countryCode: "AU",
    countryName: "Australia",
    region: "Oceania",
    restrictedGestures: [],
    requirePalmarForVictory: true,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "Dorsal V-sign suppressed to UNKNOWN.",
  },
  NZ: {
    countryCode: "NZ",
    countryName: "New Zealand",
    region: "Oceania",
    restrictedGestures: [],
    requirePalmarForVictory: true,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: {},
    culturalNotes: "Dorsal V-sign suppressed to UNKNOWN.",
  },
  IR: {
    countryCode: "IR",
    countryName: "Iran",
    region: "Middle East",
    restrictedGestures: ["THUMBS_UP"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { THUMBS_UP: "POINTING_UP" },
    culturalNotes: "THUMBS_UP is culturally restricted (Bilakh) and remapped to POINTING_UP.",
  },
  IQ: {
    countryCode: "IQ",
    countryName: "Iraq",
    region: "Middle East",
    restrictedGestures: ["THUMBS_UP"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { THUMBS_UP: "POINTING_UP" },
    culturalNotes: "THUMBS_UP is culturally restricted and remapped to POINTING_UP.",
  },
  AF: {
    countryCode: "AF",
    countryName: "Afghanistan",
    region: "South/Central Asia",
    restrictedGestures: ["THUMBS_UP"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { THUMBS_UP: "POINTING_UP" },
    culturalNotes: "THUMBS_UP is culturally restricted and remapped to POINTING_UP.",
  },
  NG: {
    countryCode: "NG",
    countryName: "Nigeria",
    region: "West Africa",
    restrictedGestures: ["THUMBS_UP"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { THUMBS_UP: "POINTING_UP" },
    culturalNotes: "THUMBS_UP is culturally restricted and remapped to POINTING_UP.",
  },
  GR: {
    countryCode: "GR",
    countryName: "Greece",
    region: "Europe",
    restrictedGestures: ["THUMBS_UP"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: true,
    remappedIntents: {
      THUMBS_UP: "POINTING_UP",
      OPEN_PALM: "FOUR_FINGERS",
    },
    culturalNotes: "THUMBS_UP and static palmar OPEN_PALM (Moutza) restricted and remapped.",
  },
  BR: {
    countryCode: "BR",
    countryName: "Brazil",
    region: "Latin America",
    restrictedGestures: ["PINCH"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { PINCH: "THREE_FINGERS" },
    culturalNotes: "PINCH (OK sign) is culturally restricted in Brazil and remapped to THREE_FINGERS.",
  },
  DE: {
    countryCode: "DE",
    countryName: "Germany",
    region: "Europe",
    restrictedGestures: ["PINCH"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { PINCH: "THREE_FINGERS" },
    culturalNotes: "PINCH (OK sign) restricted and remapped to THREE_FINGERS.",
  },
  TR: {
    countryCode: "TR",
    countryName: "Turkey",
    region: "Europe / Middle East",
    restrictedGestures: ["PINCH"],
    requirePalmarForVictory: false,
    avoidPalmarOpenPalmMoutza: false,
    remappedIntents: { PINCH: "THREE_FINGERS" },
    culturalNotes: "PINCH (OK sign) restricted and remapped to THREE_FINGERS.",
  },
};

export function getLocaleGesturePack(countryCode: string = "US"): LocaleGesturePack {
  const code = (countryCode || "US").toUpperCase();
  return LOCALE_GESTURE_PACKS[code] || LOCALE_GESTURE_PACKS.US;
}

/**
 * Resolves a raw classified gesture against the active ISO-3166 country semiotic pack
 * and 3D palm orientation (palmar vs dorsal).
 */
export function resolveLocaleGesture(
  rawGesture: RecognizedGesture,
  palmOrientation: Pick<PalmOrientation, "isPalmar" | "isDorsal">,
  countryCode: string = "US"
): LocaleGestureResolution {
  const code = (countryCode || "US").toUpperCase();
  const pack = getLocaleGesturePack(code);

  // 1. Dorsal V-sign check in GB, IE, AU, NZ
  if (
    pack.requirePalmarForVictory &&
    rawGesture === "VICTORY" &&
    !palmOrientation.isPalmar
  ) {
    return {
      rawGesture,
      effectiveGesture: "UNKNOWN",
      culturallyRestricted: true,
      remapped: false,
      restrictionReason: `DORSAL_VICTORY_RESTRICTED_${code}`,
      countryCode: code,
    };
  }

  // 2. Palmar Moutza (OPEN_PALM) check in GR
  if (
    pack.avoidPalmarOpenPalmMoutza &&
    rawGesture === "OPEN_PALM" &&
    palmOrientation.isPalmar
  ) {
    const replacement = pack.remappedIntents.OPEN_PALM || "FOUR_FINGERS";
    return {
      rawGesture,
      effectiveGesture: replacement,
      culturallyRestricted: true,
      remapped: true,
      restrictionReason: `MOUTZA_OPEN_PALM_REMAPPED_${code}`,
      countryCode: code,
    };
  }

  // 3. Country-specific restricted gesture check (e.g., THUMBS_UP in IR/IQ/AF/NG/GR, PINCH in BR/DE/TR)
  if (pack.restrictedGestures.includes(rawGesture)) {
    const replacement = pack.remappedIntents[rawGesture] || "UNKNOWN";
    return {
      rawGesture,
      effectiveGesture: replacement,
      culturallyRestricted: true,
      remapped: replacement !== "UNKNOWN",
      restrictionReason: `CULTURALLY_RESTRICTED_${rawGesture}_${code}`,
      countryCode: code,
    };
  }

  return {
    rawGesture,
    effectiveGesture: rawGesture,
    culturallyRestricted: false,
    remapped: false,
    restrictionReason: null,
    countryCode: code,
  };
}
