"""Configuration loader using pathlib and PyYAML with safe defaults."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

from steadygate import REPO_ROOT

DEFAULT_CONFIG: dict[str, Any] = {
    "version": "2.0.0",
    "features": {
        "flight_recorder": True,
        "coach_overlay": True,
        "digital_twin": True,
        "adaptive_health": True,
        "chaos_lab": True,
        "webhook_adapter": False,
        "privacy_record_consent": True,
        "ml_training_pipeline": True,
        "environmental_adaptation": True,
        "face_intent_verification": True,
        "actuator_circuit_breaker": True,
        "aruco_spatial_locking": True,
        "ampere_load_timing_matrix": True,
    },
    "ampere_load_matrix": {
        "note": "Hardware electrical profiles for Ampere-Load Dynamic Hand Gesture Timing Matrix",
        "formula": "hold_required = load_ampere_class_baseline * (1.0 + tremor_coefficient)",
        "classes": {
            "LOW_AMPERE": {"max_amperes": 1.0, "hold_baseline_sec": 0.35},
            "MEDIUM_AMPERE": {"max_amperes": 5.0, "hold_baseline_sec": 1.20},
            "HIGH_AMPERE": {"max_amperes": 20.0, "hold_baseline_sec": 1.80},
        },
    },
    "aruco": {
        "dictionary": "DICT_4X4_50",
        "marker_size_px": 120,
        "anchor_expand_margin": 0.12,
        "markers": {
            10: {
                "marker_id": 10,
                "device_id": "lamp",
                "label": "Light Bulb 1 (Primary Lamp)",
                "bbox": [0.15, 0.15, 0.65, 0.75],
            },
            11: {
                "marker_id": 11,
                "device_id": "lamp_2",
                "label": "Light Bulb 2 (Secondary Lamp)",
                "bbox": [0.66, 0.15, 0.92, 0.75],
            },
            20: {
                "marker_id": 20,
                "device_id": "fan",
                "label": "Ceiling / Table Fan",
                "bbox": [0.15, 0.15, 0.85, 0.85],
            },
            30: {
                "marker_id": 30,
                "device_id": "curtain",
                "label": "Motorized Window Curtain",
                "bbox": [0.10, 0.10, 0.90, 0.90],
            },
            40: {
                "marker_id": 40,
                "device_id": "heater",
                "label": "Simulated Radiant Heater [HIGH]",
                "bbox": [0.20, 0.20, 0.80, 0.80],
            },
        },
    },
    "policy": {
        "min_score": 0.70,
        "min_landmark_quality": 0.50,
        "hold_required_sec": 0.80,
        "confirm_hold_required_sec": 0.50,
        "arm_timeout_sec": 4.0,
        "request_timeout_sec": 5.0,
        "release_timeout_sec": 3.0,
        "confirm_timeout_sec": 4.0,
        "max_timestamp_gap_sec": 0.50,
        "ambiguous_boundary_ratio": 0.75,
        "roi": {
            "x_min": 0.10,
            "x_max": 0.90,
            "y_min": 0.10,
            "y_max": 0.90,
        },
        "risk_tier_hold_sec": {
            "LOW": 0.80,
            "MEDIUM": 1.20,
            "HIGH": 1.80,
        },
    },
    "adaptation": {
        "window_size": 90,
        "base_min_detection_confidence": 0.45,
        "low_lux_step_multiplier": 0.15,
        "low_lux_threshold": 0.35,
        "lighting_variance_threshold": 0.08,
        "ema_alpha": 0.35,
        "ambiguous_boundary_ratio": 0.75,
    },
    "face_intent": {
        "max_head_angle_deg": 20.0,
        "require_gaze_in_zone": True,
    },
    "health": {
        "threshold_provenance": "heuristic, tuned via Chaos Lab",
        "window_size": 30,
        "good_to_degraded_score": 0.65,
        "degraded_to_good_score": 0.75,
        "degraded_to_poor_score": 0.38,
        "poor_to_degraded_score": 0.48,
        "min_brightness": 0.25,
        "max_wrist_jitter": 0.06,
        "min_fps": 15.0,
        "min_detection_rate": 0.60,
        "min_mean_score": 0.65,
    },
    "devices": {
        "lamp": {
            "device_id": "lamp",
            "name": "Lamp",
            "aruco_marker_id": 10,
            "ampere_rating": 0.15,
            "load_ampere_class": "LOW_AMPERE",
            "load_ampere_class_baseline": 0.35,
            "risk_tier": "LOW",
            "default_state": "OFF",
            "allowed_commands": ["SET_ON", "SET_OFF"],
        },
        "lamp_2": {
            "device_id": "lamp_2",
            "name": "Lamp 2",
            "aruco_marker_id": 11,
            "ampere_rating": 0.15,
            "load_ampere_class": "LOW_AMPERE",
            "load_ampere_class_baseline": 0.35,
            "risk_tier": "LOW",
            "default_state": "OFF",
            "allowed_commands": ["SET_ON", "SET_OFF"],
        },
        "fan": {
            "device_id": "fan",
            "name": "Fan",
            "aruco_marker_id": 20,
            "ampere_rating": 1.85,
            "load_ampere_class": "HIGH_AMPERE",
            "load_ampere_class_baseline": 1.20,
            "risk_tier": "MEDIUM",
            "default_state": "OFF",
            "allowed_commands": ["SET_ON", "SET_OFF", "SET_SPEED_1", "SET_SPEED_2", "SET_SPEED_3"],
        },
        "curtain": {
            "device_id": "curtain",
            "name": "Curtain",
            "aruco_marker_id": 30,
            "ampere_rating": 0.40,
            "load_ampere_class": "LOW_AMPERE",
            "load_ampere_class_baseline": 0.35,
            "risk_tier": "LOW",
            "default_state": "CLOSED",
            "allowed_commands": ["SET_OPEN", "SET_CLOSED"],
        },
        "heater": {
            "device_id": "heater",
            "name": "Heater",
            "aruco_marker_id": 40,
            "ampere_rating": 12.50,
            "load_ampere_class": "HIGH_AMPERE",
            "load_ampere_class_baseline": 1.80,
            "risk_tier": "HIGH",
            "default_state": "OFF",
            "auto_expire_sec": 120.0,
            "allowed_commands": ["SET_ON", "SET_OFF"],
        },
    },
    "server": {
        "host": "127.0.0.1",
        "port": 8765,
    },
    "paths": {
        "model_asset": "public/models/hand_landmarker.task",
        "logs_dir": "logs",
        "storage_dir": "storage",
        "reports_dir": "reports",
    },
}


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = deepcopy(v)
    return result


def load_config(config_path: Path | str | None = None) -> dict[str, Any]:
    """Load configuration from config.yaml merged over DEFAULT_CONFIG."""
    path = Path(config_path) if config_path is not None else (REPO_ROOT / "config.yaml")
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    if not path.exists():
        return deepcopy(DEFAULT_CONFIG)
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"Configuration file {path} must contain a YAML mapping.")
    return _deep_merge(DEFAULT_CONFIG, raw)


def is_feature_enabled(config: dict[str, Any], feature_name: str) -> bool:
    """Return True if a feature flag is enabled in config."""
    return bool(config.get("features", {}).get(feature_name, False))
