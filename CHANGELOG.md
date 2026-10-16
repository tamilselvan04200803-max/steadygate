# CHANGELOG (`CHANGELOG.md`)

All notable changes to the SteadyGate architecture and runtime are documented in this file.

---

## [2.0.0-Alpha.3] - 2026-10-16
### Added & Fixed
- **Guard 6 (`WIDE_PHONE_OR_OBJECT_CLASP` in `src/lib/hand-gesture-engine.ts`)**: Resolved Failure Case 1 (`Screenshot 2026-10-16 114707.png` — holding a smartphone with index extended along top edge misclassified as `POINTING_UP`) by blocking wide opposing thumb-to-knuckle spans (`idx >= 0.50 && Math.max(mid, rng, pnk) < 0.45 && d4_5 > 0.72 && d4_10 > 1.10 && d4_14 > 1.10`).
- **Side-Profile Free-Hand Exemption (`src/lib/hand-gesture-engine.ts`)**: Resolved Failure Case 2 (`Screenshot 2026-10-16 114648.png` — empty side-profile hand falsely blocked as `PALM_OCCLUDED_BY_OBJECT`) by exempting natural 3D side-profile hands (`aspect > 3.6 && aspect <= 6.2 && palmLen >= 0.22 && fourMin >= 0.70 && Math.abs(landmarks[9].x - wrist.x) / palmLen >= 0.28`) so they classify cleanly as `OPEN_PALM`.
- **Guard 7 (`CASUAL_FACE_TOUCH_OR_SCRATCH`) + Face/Nose ROI Overlap Guard (`src/lib/hand-gesture-engine.ts`, `src/lib/vision-runtime.ts`, `src/components/LiveCameraStream.tsx`)**: Resolved Failure Case 3 (`Screenshot 2026-10-16 121013.png` — nose tingling / face scratching misclassified as `FIST`) via dual biomechanical dorsal/scratch rejection (`thumb < 0.48 && d4_9 < 0.68 && Math.min(mIdx, mMid) < 45 && Math.max(sIdx, sMid) > 0.65 && fourMean < 0.35`) and live upper-central Face/Nose ROI YCbCr skin-cluster overlap detection (`SceneAnalyzer.detectFaceNoseOverlap`).
- **60 Hz / 30 Hz Frame Synchronization & Immediate Voter Flush (`src/components/LiveCameraStream.tsx`)**: Cached `r.lastLandmarks` across intermediate 60 Hz `requestAnimationFrame` ticks (`now - r.lastHandTs < 150 ms`) and added immediate `voterRef.current.reset()` on `isObjectGrasp === true`.
- **Atomic File Persistence (`src/app/api/admin-train/route.ts`)**: Hardened JSON persistence with POSIX atomic write-then-rename (`atomicWriteJsonSync`) to prevent partial-write race conditions under concurrent requests.
- **Documentation Streamlining (`README.md`, `DECISIONS.md`)**: Structured documentation directly around **Root-Cause Failure Analysis → Biomechanical & Signal Invariants → Verification Matrix** centered on the unified Next.js/TypeScript runtime.

---

## [2.0.0-unified-hub] - 2026-10-15
### Added & Fixed
- **Unified Single-Origin Hub (`ADR-001`)**: Integrated the interactive Smart-House Digital Twin directly into the main Next.js application (`port 3000`) so gesture recognition, appliance state, and simulation run on a single unified TypeScript origin.
- **60-Second Personalized Enrolment (`src/components/EnrolmentModal.tsx`, `src/app/api/enrol/route.ts`)**: Extended enrolment duration from `10s` to `60s` (`1,800` frames at `30 Hz` across 4 guided 15-second posture stages) capturing dominant tremor frequency (`f0Hz`), RMS amplitude, band-stop filter range, palm scale, finger flexibility, per-finger extension baselines, and 60s fatigue drift.
- **Continuous Background User Data Storage (`src/lib/storage-logger.ts`, `src/app/api/user-data/route.ts`)**: Added background telemetry & morphology collection every 4s and during enrolment/actuation, persisting to `storage/users_personalized.json`, `storage/user_<id>_profile.json`, `storage/appliance_states.json`, `logs/user_observations.jsonl`, `logs/enrolment_history.jsonl`, and `logs/actuation_events.jsonl`.
- **Default Gesture-to-Appliance Mapping & Auto-Actuation (`src/lib/default-gesture-map.ts`, `src/app/page.tsx`, `src/app/api/actuate/route.ts`)**: Mapped default hand gestures (`OPEN_PALM` -> `fan_table`, `POINTING_UP` -> `lamp_desk`, `VICTORY` -> `ac_living`, `PINCH` -> `blinds_window`, `THUMBS_UP` -> `heater_radiant`, `THUMBS_DOWN` -> `tv_ambient`, `FIST` -> `door_deadbolt`) with live auto-hold actuation and dashboard notification banner/toasts.
- **Appliance Power Toggle & Fan Rotor SVG Fix (`src/components/LiveHouseScene.tsx`, `src/components/SmartHouseSimulator.tsx`, `src/components/ApplianceCardGrid.tsx`)**: Fixed the fan blade CSS `transform-box` wobble glitch using hub-centered SVG `<animateTransform type="rotate" from="0 0 0" to="360 0 0" />`, and added working `Turn ON / Turn OFF` buttons to every appliance across all views.
- **Frontend Cleanup (`src/components/Header.tsx`)**: Removed unused/unwanted frontend pages (`PatentDisclosureView.tsx`, `AdminAgentConsole.tsx`, `BenchmarkLab.tsx`).
