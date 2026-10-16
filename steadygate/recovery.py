"""Recovery Engine: Maps every ReasonCode to a plain-language recovery message.

Describes only observable conditions and concrete recovery steps — zero assumptions
about hidden user intent.
"""

from __future__ import annotations

from steadygate.events import ReasonCode

CIRCUIT_BREAKER_ALERT_MESSAGE = (
    "Action blocked: Target appliance reporting component degradation."
)

RECOVERY_MAP: dict[ReasonCode, str] = {
    ReasonCode.NO_HAND: (
        "No hand detected in the camera frame. Raise one hand clearly into the interaction zone."
    ),
    ReasonCode.OUTSIDE_ZONE: (
        "Hand is outside the active interaction zone. Move your hand toward the center of the frame."
    ),
    ReasonCode.LOW_SCORE: (
        "Gesture confidence or landmark clarity is below the threshold. Hold your fingers steady facing the camera."
    ),
    ReasonCode.UNKNOWN_GESTURE: (
        "Detected hand pose does not match an active gesture for this step. Show OPEN_PALM to arm or a valid target gesture."
    ),
    ReasonCode.STALE_OBSERVATION: (
        "Observation timestamp did not advance. Ensure the video stream is delivering fresh frames."
    ),
    ReasonCode.TIMESTAMP_GAP: (
        "A frame timing gap exceeded the safety limit. Re-arm with OPEN_PALM once camera framing is steady."
    ),
    ReasonCode.HOLD_TOO_SHORT: (
        "Gesture hold duration is not yet complete. Keep holding the pose steady until the progress ring reaches 100%."
    ),
    ReasonCode.NOT_RELEASED: (
        "Waiting for neutral hand release before the next step. Relax to OPEN_PALM briefly to clear the held gesture."
    ),
    ReasonCode.TARGET_CHANGED: (
        "Hand pose changed to a different target during the hold window. Return to OPEN_PALM and hold a single gesture."
    ),
    ReasonCode.TIMEOUT: (
        "The current interaction step timed out. Show OPEN_PALM inside the zone to start a fresh sequence."
    ),
    ReasonCode.USER_CANCEL: (
        "CLOSED_FIST detected; the active sequence was canceled and reset to IDLE. Show OPEN_PALM when ready."
    ),
    ReasonCode.HEALTH_STRICT: (
        "Tracking health is DEGRADED; required hold duration is doubled and HIGH-risk devices are paused. Improve lighting or steady your hand."
    ),
    ReasonCode.HEALTH_LOCKED: (
        "Tracking health is POOR; all device actions are locked for safety. Increase room lighting and keep a single hand in frame."
    ),
    ReasonCode.AMBIGUOUS_TARGET: (
        "Multiple hands or conflicting target signals detected in frame. Keep only one controlling hand inside the interaction zone."
    ),
    ReasonCode.ACK_MISSING: (
        "Simulated device acknowledgment timed out; state change was not confirmed. Verify virtual device connectivity and retry from OPEN_PALM."
    ),
    ReasonCode.OUTCOME_UNKNOWN: (
        "Simulated device reported an unknown outcome state. Inspect the Digital Twin status panel before issuing another command."
    ),
    ReasonCode.USER_DISTRACTED: (
        "Face orientation or eye gaze is outside the active interaction zone (+/-20 deg limit). Face the camera directly while holding the gesture."
    ),
    ReasonCode.DEVICE_FAULT_LOCK: CIRCUIT_BREAKER_ALERT_MESSAGE,
}


def get_recovery_message(reason_code: str | ReasonCode) -> str:
    """Return the plain-language recovery message for a given ReasonCode."""
    code = ReasonCode(reason_code)
    return RECOVERY_MAP[code]
