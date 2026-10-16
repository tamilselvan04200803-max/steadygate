"""Feedforward Coach Overlay (`steadygate/coach.py`).

Bound strictly to `policy.describe()`. Uses OpenCV (`cv2`) to draw a hold-progress ring,
active state badge, available next actions, telemetry health indicator, ArUco spatial anchor
alignment indicator, face intent status, circuit-breaker degradation alert banner, and
plain-language rejection recovery strings onto BGR frames.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from steadygate.actuator import VirtualActuator
from steadygate.config import is_feature_enabled, load_config
from steadygate.events import Observation
from steadygate.policy import SteadyGatePolicy
from steadygate.recovery import CIRCUIT_BREAKER_ALERT_MESSAGE

STATE_COLORS_BGR: dict[str, tuple[int, int, int]] = {
    "IDLE": (160, 160, 160),
    "ARMED": (255, 200, 0),
    "REQUESTING": (0, 215, 255),
    "AMBIGUOUS_STATE": (0, 190, 255),
    "HOLDING": (0, 220, 120),
    "AWAITING_RELEASE": (0, 165, 255),
    "AWAITING_CONFIRM": (255, 140, 0),
}

HEALTH_COLORS_BGR: dict[str, tuple[int, int, int]] = {
    "GOOD": (80, 220, 100),
    "DEGRADED": (0, 180, 255),
    "POOR": (60, 60, 240),
}


class FeedforwardCoach:
    """OpenCV HUD overlay renderer bound strictly to `policy.describe()`."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        self.enabled = is_feature_enabled(self.config, "coach_overlay")
        self.roi = self.config.get("policy", {}).get(
            "roi", {"x_min": 0.10, "x_max": 0.90, "y_min": 0.10, "y_max": 0.90}
        )
        self.last_alert_banner: str | None = None

    def render(
        self,
        frame_bgr: np.ndarray,
        policy_or_desc: SteadyGatePolicy | dict[str, Any],
    ) -> np.ndarray:
        """Draw the Feedforward Coach overlay onto a copy of `frame_bgr` using `policy.describe()`."""
        canvas = frame_bgr.copy()
        if not self.enabled:
            return canvas

        desc: dict[str, Any] = (
            policy_or_desc.describe()
            if hasattr(policy_or_desc, "describe")
            else dict(policy_or_desc)
        )

        h, w = canvas.shape[:2]
        state_str = str(desc.get("current_state", "IDLE"))
        hold_prog = desc.get("hold_progress", {"elapsed": 0.0, "required": 0.8, "ratio": 0.0})
        thresholds = desc.get("active_thresholds", {})
        health_str = str(thresholds.get("health_level", "GOOD"))
        reason_code = str(desc.get("last_reason_code", "NO_HAND"))
        recovery_msg = str(desc.get("recovery_message", ""))
        next_actions = list(desc.get("available_next_actions", []))
        target_dev = str(desc.get("target_device", "lamp"))
        target_cmd = str(desc.get("target_command", "SET_ON"))
        risk_tier = str(desc.get("risk_tier", "LOW"))
        aruco_anchor = desc.get(
            "aruco_anchor",
            {
                "marker_id": 10,
                "device_id": target_dev,
                "label": target_dev,
                "bbox": [0.15, 0.15, 0.85, 0.85],
                "aligned": reason_code != "OUTSIDE_ZONE",
            },
        )
        cb_alert = desc.get("circuit_breaker_alert")
        if reason_code == "DEVICE_FAULT_LOCK" and not cb_alert:
            cb_alert = CIRCUIT_BREAKER_ALERT_MESSAGE
        self.last_alert_banner = str(cb_alert) if cb_alert else None

        # 1. Draw interaction zone ROI rectangle
        x1 = int(self.roi["x_min"] * w)
        y1 = int(self.roi["y_min"] * h)
        x2 = int(self.roi["x_max"] * w)
        y2 = int(self.roi["y_max"] * h)
        cv2.rectangle(canvas, (x1, y1), (x2, y2), (90, 90, 90), 1)

        # 1b. Draw ArUco spatial anchor alignment indicator box
        ab = aruco_anchor.get("bbox", [0.15, 0.15, 0.85, 0.85])
        ax1, ay1 = int(float(ab[0]) * w), int(float(ab[1]) * h)
        ax2, ay2 = int(float(ab[2]) * w), int(float(ab[3]) * h)
        aligned = bool(aruco_anchor.get("aligned", True))
        anchor_color = (80, 225, 130) if aligned else (70, 90, 240)
        cv2.rectangle(canvas, (ax1, ay1), (ax2, ay2), anchor_color, 1)
        cv2.putText(
            canvas,
            f"ArUco #{aruco_anchor.get('marker_id', 10)} [{aruco_anchor.get('device_id', target_dev)}] "
            f"{'LOCKED' if aligned else 'ALIGN HAND'}",
            (ax1 + 6, max(ay1 + 18, 68)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            anchor_color,
            1,
            cv2.LINE_AA,
        )

        # 2. Top status header bar
        cv2.rectangle(canvas, (0, 0), (w, 54), (24, 24, 28), -1)
        state_color = STATE_COLORS_BGR.get(state_str, (200, 200, 200))
        health_color = HEALTH_COLORS_BGR.get(health_str, (200, 200, 200))

        cv2.putText(
            canvas,
            f"STATE: {state_str}",
            (14, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            state_color,
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            f"TARGET: {target_dev}:{target_cmd} [{risk_tier}] (simulated)",
            (14, 46),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.46,
            (210, 210, 210),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            f"HEALTH: {health_str}",
            (max(14, w - 185), 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            health_color,
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            f"CODE: {reason_code}",
            (max(14, w - 185), 46),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (180, 180, 220),
            1,
            cv2.LINE_AA,
        )

        # 2b. Actuator Health Circuit Breaker Alert Banner
        if self.last_alert_banner:
            cv2.rectangle(canvas, (0, 56), (w, 92), (25, 25, 190), -1)
            cv2.putText(
                canvas,
                self.last_alert_banner,
                (14, 80),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.48,
                (255, 255, 255),
                2,
                cv2.LINE_AA,
            )

        # 3. Hold-progress ring (center-right HUD gauge)
        ring_cx = int(w * 0.82)
        ring_cy = int(h * 0.42)
        ring_radius = max(28, int(min(w, h) * 0.11))

        # Background ring
        cv2.circle(canvas, (ring_cx, ring_cy), ring_radius, (55, 55, 65), 6, cv2.LINE_AA)

        ratio = float(hold_prog.get("ratio", 0.0))
        elapsed = float(hold_prog.get("elapsed", 0.0))
        required = float(hold_prog.get("required", 0.8))
        sweep_angle = int(round(max(0.0, min(1.0, ratio)) * 360.0))
        if sweep_angle > 0:
            cv2.ellipse(
                canvas,
                (ring_cx, ring_cy),
                (ring_radius, ring_radius),
                -90,
                0,
                sweep_angle,
                state_color,
                6,
                cv2.LINE_AA,
            )

        pct_text = f"{int(round(ratio * 100))}%"
        cv2.putText(
            canvas,
            pct_text,
            (ring_cx - 22, ring_cy + 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (245, 245, 245),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            f"{elapsed:.2f}/{required:.2f}s",
            (ring_cx - 38, ring_cy + ring_radius + 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (200, 200, 200),
            1,
            cv2.LINE_AA,
        )

        # 4. Bottom feedforward & recovery footer
        footer_top = max(60, h - 72)
        cv2.rectangle(canvas, (0, footer_top), (w, h), (24, 24, 28), -1)

        next_str = " | ".join(next_actions[:2]) if next_actions else "NONE"
        cv2.putText(
            canvas,
            f"NEXT: {next_str[:78]}",
            (14, footer_top + 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.44,
            (140, 230, 255),
            1,
            cv2.LINE_AA,
        )
        cv2.putText(
            canvas,
            f"RECOVERY: {recovery_msg[:88]}",
            (14, footer_top + 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42,
            (235, 215, 160),
            1,
            cv2.LINE_AA,
        )

        return canvas


CoachOverlayRenderer = FeedforwardCoach


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="steadygate.coach",
        description="Render SteadyGate Feedforward Coach Overlay bound to policy.describe()",
    )
    parser.add_argument("--config", type=Path, default=None, help="Path to config.yaml")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Optional PNG path to save rendered verification frame",
    )
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    policy = SteadyGatePolicy(cfg, actuator=VirtualActuator(cfg))
    coach = FeedforwardCoach(cfg)

    # Step into an active HOLDING state to render a populated hold ring
    policy.step(0.0, 0, Observation("OPEN_PALM", 0.94, True, 0.92))
    policy.step(0.2, 1, Observation("POINTING_UP", 0.95, True, 0.92))
    policy.step(0.6, 2, Observation("POINTING_UP", 0.95, True, 0.92))

    base_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    rendered = coach.render(base_frame, policy)

    if args.out is not None:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(args.out), rendered)
        print(f"Saved Feedforward Coach overlay frame to {args.out}")
    else:
        desc = policy.describe()
        print(
            f"FeedforwardCoach rendered frame {rendered.shape[1]}x{rendered.shape[0]} | "
            f"state={desc['current_state']} | ratio={desc['hold_progress']['ratio']:.2f} | "
            f"recovery='{desc['recovery_message']}'"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
