import { HandLandmark2D, HandParameters, RecognizedGesture, UserProfile } from "./types";

/**
 * Default Smart Home mapping for the 5 core gestures:
 */
export const GESTURE_SMART_HOME_MAP: Record<
  RecognizedGesture,
  { action: string; applianceCategory: string; description: string; icon: string }
> = {
  OPEN_PALM: {
    action: "TOGGLE_POWER",
    applianceCategory: "Lighting / General",
    description: "Turn ON / OFF lights & reading lamp",
    icon: "✋",
  },
  THUMBS_UP: {
    action: "CONFIRM_OR_STEP_UP",
    applianceCategory: "Safety / Handshake",
    description: "Confirm R2 Space Heater / Geyser handshake or Increase Fan/Temp",
    icon: "👍",
  },
  VICTORY: {
    action: "CYCLE_FAN_SPEED",
    applianceCategory: "Climate / Fan",
    description: "Cycle Fan Speed (Off → 1 → 2 → 3 → 4 → Off)",
    icon: "✌️",
  },
  POINTING_UP: {
    action: "TOGGLE_AC_TEMP",
    applianceCategory: "Climate / AC",
    description: "Toggle AC Cooling & Step Temperature (20°C - 26°C)",
    icon: "☝️",
  },
  FIST: {
    action: "EMERGENCY_STOP_ALL",
    applianceCategory: "Safety / All",
    description: "Master All OFF & Deadbolt Lock Engagement",
    icon: "✊",
  },
  THUMBS_DOWN: {
    action: "STEP_DOWN",
    applianceCategory: "Climate",
    description: "Decrease Fan Speed / Lower AC Temperature",
    icon: "👎",
  },
  PINCH: {
    action: "FINE_DIM",
    applianceCategory: "Lighting",
    description: "Fine analog brightness adjust (Pinch & drag)",
    icon: "👌",
  },
  UNKNOWN: {
    action: "IDLE",
    applianceCategory: "None",
    description: "Unrecognized transition or hand at rest",
    icon: "❓",
  },
};

/**
 * Calculates Euclidean distance between two landmarks.
 */
function dist(p1: HandLandmark2D, p2: HandLandmark2D): number {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Extracts normalized hand morphology and 5 finger extension ratios.
 * 21 Landmarks standard indices:
 * 0: Wrist
 * 1-4: Thumb (CMC, MCP, IP, TIP)
 * 5-8: Index (MCP, PIP, DIP, TIP)
 * 9-12: Middle (MCP, PIP, DIP, TIP)
 * 13-16: Ring (MCP, PIP, DIP, TIP)
 * 17-20: Pinky (MCP, PIP, DIP, TIP)
 */
export function extractHandParameters(landmarks: HandLandmark2D[]): HandParameters {
  if (!landmarks || landmarks.length < 21) {
    return {
      palmWidth: 0.2,
      palmLength: 0.25,
      spanRatio: 1.0,
      fingerFlexion: [0.5, 0.5, 0.5, 0.5, 0.5],
      aspectRatio: 1.25,
      tiltAngleDeg: 0,
    };
  }

  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const thumbMcp = landmarks[2];
  const indexMcp = landmarks[5];
  const indexTip = landmarks[8];
  const middleMcp = landmarks[9];
  const middleTip = landmarks[12];
  const ringMcp = landmarks[13];
  const ringTip = landmarks[16];
  const pinkyMcp = landmarks[17];
  const pinkyTip = landmarks[20];

  // Palm dimensions
  const palmWidth = dist(indexMcp, pinkyMcp);
  const palmLength = dist(wrist, middleMcp);
  const span = dist(thumbTip, pinkyTip);
  const spanRatio = palmWidth > 0 ? span / palmWidth : 1.0;
  const aspectRatio = palmWidth > 0 ? palmLength / palmWidth : 1.25;

  // Tilt angle of the hand in degrees
  const angleRad = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
  const tiltAngleDeg = Math.round((angleRad * 180) / Math.PI + 90);

  // Normalization baseline (distance from wrist to middle MCP)
  const baseScale = Math.max(palmLength, 0.05);

  /**
   * Extension = blend of two cues so the estimate survives perspective:
   *  (a) reach: distance(wrist, tip)/palmLength — fails when hand tilts toward camera
   *  (b) straightness: interior angle at PIP (mcp–pip–tip). Extended ≈ 180°, curled ≈ 60–110°.
   *      Angle survives foreshortening far better than raw reach.
   */
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  const angleAt = (a: HandLandmark2D, b: HandLandmark2D, c: HandLandmark2D) => {
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const d = v1x * v2x + v1y * v2y;
    const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1e-6;
    return (Math.acos(Math.max(-1, Math.min(1, d / m))) * 180) / Math.PI;
  };
  const straight = (mcp: number, pip: number, tip: number) =>
    clamp01((angleAt(landmarks[mcp], landmarks[pip], landmarks[tip]) - 100) / 65);
  // reach also compares tip-to-MCP against PIP-to-MCP: a curled tip lands near/behind the MCP
  const reach = (mcp: number, tip: number, lo: number, span: number) => {
    const wristReach = clamp01((dist(wrist, landmarks[tip]) / baseScale - lo) / span);
    const foldBack = clamp01(dist(landmarks[mcp], landmarks[tip]) / baseScale / 0.9);
    return 0.6 * wristReach + 0.4 * foldBack;
  };
  const blend = (r: number, s: number) => 0.45 * r + 0.55 * s;

  const indexExt = blend(reach(5, 8, 1.1, 0.9), straight(5, 6, 8));
  const middleExt = blend(reach(9, 12, 1.15, 0.95), straight(9, 10, 12));
  const ringExt = blend(reach(13, 16, 1.05, 0.85), straight(13, 14, 16));
  const pinkyExt = blend(reach(17, 20, 0.95, 0.75), straight(17, 18, 20));
  // Thumb: straightness at IP plus abduction away from the index MCP (folded thumb tucks across palm)
  const thumbStraight = clamp01((angleAt(landmarks[2], landmarks[3], landmarks[4]) - 120) / 50);
  const thumbAbduct = clamp01((dist(thumbTip, indexMcp) / baseScale - 0.35) / 0.55);
  const thumbReach = clamp01((dist(wrist, thumbTip) / baseScale - 0.9) / 0.8);
  const thumbExt = 0.4 * thumbStraight + 0.35 * thumbAbduct + 0.25 * thumbReach;

  return {
    palmWidth: Math.round(palmWidth * 1000) / 1000,
    palmLength: Math.round(palmLength * 1000) / 1000,
    spanRatio: Math.round(spanRatio * 100) / 100,
    fingerFlexion: [thumbExt, indexExt, middleExt, ringExt, pinkyExt],
    aspectRatio: Math.round(aspectRatio * 100) / 100,
    tiltAngleDeg,
  };
}

/**
 * Real-time gesture classification with user hand adaptation & personalized prototypes.
 */
export function classifyHandGesture(
  landmarks: HandLandmark2D[],
  userProfile?: UserProfile | null
): {
  gesture: RecognizedGesture;
  confidence: number;
  top2Gesture: RecognizedGesture;
  margin: number;
  handParams: HandParameters;
  fingerStates: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  personalizedBoostApplied: boolean;
} {
  const handParams = extractHandParameters(landmarks);
  const [thumb, index, middle, ring, pinky] = handParams.fingerFlexion;

  // Personalization adjustments:
  // If user has Parkinson's / tremors / motor flexion restrictions,
  // adapt the threshold using fingerFlexibility parameter
  const flexScale = userProfile?.fingerFlexibility || 1.0;
  const extendThreshold = 0.58 * flexScale;
  const curlThreshold = 0.42 * (2.0 - flexScale);

  const thumbOpen = thumb >= extendThreshold;
  const indexOpen = index >= extendThreshold;
  const middleOpen = middle >= extendThreshold;
  const ringOpen = ring >= extendThreshold;
  const pinkyOpen = pinky >= extendThreshold;

  const fingerStates = {
    thumb: thumbOpen,
    index: indexOpen,
    middle: middleOpen,
    ring: ringOpen,
    pinky: pinkyOpen,
  };

  // Evaluate scores for each candidate gesture
  const scores: Record<RecognizedGesture, number> = {
    OPEN_PALM: 0,
    THUMBS_UP: 0,
    VICTORY: 0,
    POINTING_UP: 0,
    FIST: 0,
    THUMBS_DOWN: 0,
    PINCH: 0,
    UNKNOWN: 0.1,
  };

  // 1. OPEN_PALM: All 5 fingers extended
  scores.OPEN_PALM = (thumb + index + middle + ring + pinky) / 5.0;

  // 2. FIST: All 5 fingers curled
  scores.FIST = (5.0 - (thumb + index + middle + ring + pinky)) / 5.0;

  // 3. VICTORY: Index + Middle open, Ring + Pinky curled, Thumb folded
  const victoryOpen = (index + middle) / 2.0;
  const victoryCurled = (2.0 - (ring + pinky)) / 2.0;
  scores.VICTORY = victoryOpen * 0.6 + victoryCurled * 0.4;
  if (thumbOpen) scores.VICTORY *= 0.85;

  // 4. POINTING_UP: Index open, others curled
  const pointOpen = index;
  const pointCurled = (4.0 - (thumb + middle + ring + pinky)) / 4.0;
  scores.POINTING_UP = pointOpen * 0.65 + pointCurled * 0.35;

  // 5. THUMBS_UP: Thumb extended, 4 fingers curled, thumb tip clearly above the knuckle line.
  //    Direction is a strong, jitter-robust cue: measured in palm-lengths above the index MCP.
  const thumbsUpCurled = (4.0 - (index + middle + ring + pinky)) / 4.0;
  const wrist = landmarks[0] || { x: 0.5, y: 0.5 };
  const thumbTip = landmarks[4] || { x: 0.5, y: 0.2 };
  const indexMcpPt = landmarks[5] || { x: 0.5, y: 0.4 };
  const palmLen = Math.max(handParams.palmLength, 0.05);
  const thumbRaise = Math.min(1, Math.max(0, (indexMcpPt.y - thumbTip.y) / palmLen / 0.45));
  const thumbDrop = Math.min(1, Math.max(0, (thumbTip.y - wrist.y) / palmLen / 0.35));
  const isUpright = thumbTip.y < wrist.y;
  scores.THUMBS_UP = (thumb * 0.35 + thumbsUpCurled * 0.35 + thumbRaise * 0.3) * (isUpright ? 1.0 : 0.4);

  // A raised thumb is incompatible with a fist — suppress FIST proportionally
  scores.FIST *= 1 - 0.65 * thumbRaise;

  // 6. THUMBS_DOWN: Thumb pointing downward, 4 fingers curled
  const isDownward = thumbTip.y > wrist.y;
  scores.THUMBS_DOWN = (thumb * 0.35 + thumbsUpCurled * 0.35 + thumbDrop * 0.3) * (isDownward ? 1.0 : 0.3);

  // 7. PINCH: Thumb tip close to index tip
  if (landmarks[4] && landmarks[8]) {
    const pinchDist = dist(landmarks[4], landmarks[8]);
    scores.PINCH = Math.max(0, 1.0 - pinchDist / 0.15);
  }

  // Apply Personalized Prototype Calibration Boosts (Self-Optimization)
  let personalizedBoostApplied = false;
  if (userProfile?.personalizedPrototypes) {
    try {
      const prototypes = JSON.parse(userProfile.personalizedPrototypes);
      for (const [gestKey, config] of Object.entries(prototypes)) {
        const key = gestKey as RecognizedGesture;
        if (scores[key] !== undefined && typeof config === "object" && config !== null) {
          const boost = (config as { confidenceBoost?: number }).confidenceBoost || 1.0;
          scores[key] *= boost;
          personalizedBoostApplied = true;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Sort candidate gestures by confidence
  const sorted = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([g, score]) => ({
      gesture: g as RecognizedGesture,
      confidence: Math.min(0.99, Math.max(0.1, score)),
    }));

  const top1 = sorted[0];
  const top2 = sorted[1] || { gesture: "UNKNOWN", confidence: 0.1 };
  const margin = Math.max(0, top1.confidence - top2.confidence);

  return {
    gesture: top1.confidence >= 0.52 ? top1.gesture : "UNKNOWN",
    confidence: Math.round(top1.confidence * 100) / 100,
    top2Gesture: top2.gesture,
    margin: Math.round(margin * 100) / 100,
    handParams,
    fingerStates,
    personalizedBoostApplied,
  };
}

/**
 * Generates synthetic realistic 21 hand landmarks for any of the 5 gestures
 * with specified involuntary tremor amplitude and frequency.
 */
export function generateSyntheticGestureLandmarks(
  gesture: RecognizedGesture,
  timeSec: number,
  tremorF0Hz: number = 5.2,
  tremorAmp: number = 0.045
): HandLandmark2D[] {
  // Center coordinates
  const cx = 0.5;
  const cy = 0.55;

  // Add physiological tremor oscillation to base hand position
  const tremorY = tremorAmp * Math.sin(2 * Math.PI * tremorF0Hz * timeSec);
  const tremorX = tremorAmp * 0.4 * Math.cos(2 * Math.PI * tremorF0Hz * timeSec * 0.9);

  const baseX = cx + tremorX;
  const baseY = cy + tremorY;

  // Wrist
  const wrist: HandLandmark2D = { x: baseX, y: baseY + 0.18 };

  // Base configurations for 5 gestures:
  // Extension: 1.0 = straight, 0.0 = curled into palm
  let extThumb = 1.0;
  let extIndex = 1.0;
  let extMiddle = 1.0;
  let extRing = 1.0;
  let extPinky = 1.0;
  let thumbUp = false;

  switch (gesture) {
    case "OPEN_PALM":
      extThumb = 0.95;
      extIndex = 0.98;
      extMiddle = 1.0;
      extRing = 0.96;
      extPinky = 0.92;
      break;
    case "THUMBS_UP":
      extThumb = 0.98;
      thumbUp = true;
      extIndex = 0.15;
      extMiddle = 0.14;
      extRing = 0.12;
      extPinky = 0.10;
      break;
    case "VICTORY":
      extThumb = 0.15;
      extIndex = 0.98;
      extMiddle = 0.96;
      extRing = 0.12;
      extPinky = 0.10;
      break;
    case "POINTING_UP":
      extThumb = 0.15;
      extIndex = 1.0;
      extMiddle = 0.12;
      extRing = 0.10;
      extPinky = 0.08;
      break;
    case "FIST":
      extThumb = 0.12;
      extIndex = 0.10;
      extMiddle = 0.09;
      extRing = 0.08;
      extPinky = 0.08;
      break;
    case "PINCH":
      extThumb = 0.5;
      extIndex = 0.5;
      extMiddle = 0.12;
      extRing = 0.10;
      extPinky = 0.08;
      break;
    default:
      extThumb = 0.5;
      extIndex = 0.5;
      extMiddle = 0.5;
      extRing = 0.5;
      extPinky = 0.5;
  }

  // Compute 21 landmark positions based on extension variables
  const indexMcp = { x: baseX - 0.06, y: baseY };
  const middleMcp = { x: baseX - 0.01, y: baseY - 0.02 };
  const ringMcp = { x: baseX + 0.04, y: baseY };
  const pinkyMcp = { x: baseX + 0.08, y: baseY + 0.03 };

  // Thumb
  const thumbCmc = { x: baseX - 0.09, y: baseY + 0.09 };
  const thumbMcp = { x: baseX - 0.11, y: baseY + 0.04 };
  // Thumb: extended → abducted away from palm; folded → tucked across toward index MCP
  const thumbIp = thumbUp
    ? { x: baseX - 0.115, y: baseY - 0.04 }
    : {
        x: baseX - 0.11 - extThumb * 0.035 + (1 - extThumb) * 0.03,
        y: baseY + 0.005 - extThumb * 0.02 + (1 - extThumb) * 0.01,
      };
  const thumbTip = thumbUp
    ? { x: baseX - 0.115, y: baseY - 0.11 }
    : {
        x: baseX - 0.11 - extThumb * 0.075 + (1 - extThumb) * 0.075,
        y: baseY + 0.005 - extThumb * 0.05 + (1 - extThumb) * 0.03,
      };

  /**
   * Anatomically bent finger: constant segment lengths, joints rotate with curl.
   * ext=1 → straight; ext=0 → PIP flexed ~100°, DIP ~80°, tip folds toward the palm.
   */
  const createFinger = (mcp: HandLandmark2D, angleDeg: number, ext: number) => {
    const curl = 1 - Math.min(1, Math.max(0, ext));
    const seg = [0.075, 0.055, 0.045]; // proximal, middle, distal (normalized)
    let heading = (angleDeg * Math.PI) / 180; // 0 = straight up (−y)
    const pts: HandLandmark2D[] = [mcp];
    let cur = mcp;
    const bends = [curl * 1.75, curl * 1.4, curl * 0.9]; // radians per joint
    for (let i = 0; i < 3; i++) {
      heading += bends[i];
      cur = { x: cur.x + Math.sin(heading) * seg[i], y: cur.y - Math.cos(heading) * seg[i] };
      pts.push(cur);
    }
    return pts;
  };

  const indexFinger = createFinger(indexMcp, -8, extIndex);
  const middleFinger = createFinger(middleMcp, 0, extMiddle);
  const ringFinger = createFinger(ringMcp, 8, extRing);
  const pinkyFinger = createFinger(pinkyMcp, 16, extPinky);

  return [
    wrist,
    thumbCmc,
    thumbMcp,
    thumbIp,
    thumbTip,
    ...indexFinger,
    ...middleFinger,
    ...ringFinger,
    ...pinkyFinger,
  ];
}
