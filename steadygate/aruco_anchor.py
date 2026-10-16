"""OpenCV ArUco Spatial Anchor Locking (`steadygate/aruco_anchor.py`).

Mitigation Gate 1 (Spatial Anchor Locking):
- Integrates `cv2.aruco` (`DICT_4X4_50`) to detect physical or virtual ArUco marker
  stickers placed directly on appliances.
- Spatial Addressing: Maps duplicate appliances (e.g., Light Bulb 1 [`lamp` -> ID 10]
  and Light Bulb 2 [`lamp_2` -> ID 11]) to unique ArUco Marker IDs.
- Spatial Target Activation: Verifies whether the user's hand bounding box or index-finger
  pointing ray intersects the spatial matrix anchor of a specific ArUco Marker ID.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from steadygate.config import load_config


@dataclass(frozen=True)
class ArucoDetection:
    """Single detected ArUco marker and its normalized bounding box in frame coordinates."""

    marker_id: int
    device_id: str
    label: str
    bbox_norm: tuple[float, float, float, float]  # (x_min, y_min, x_max, y_max)
    center_xy: tuple[float, float]

    def to_dict(self) -> dict[str, Any]:
        return {
            "marker_id": self.marker_id,
            "device_id": self.device_id,
            "label": self.label,
            "bbox_norm": [round(v, 4) for v in self.bbox_norm],
            "center_xy": [round(self.center_xy[0], 4), round(self.center_xy[1], 4)],
        }


@dataclass(frozen=True)
class SpatialAnchorLockResult:
    """Result of evaluating hand landmarks / bounding box against ArUco spatial anchors."""

    locked: bool
    marker_id: int | None
    device_id: str | None
    hand_bbox_norm: tuple[float, float, float, float]
    anchor_bbox_norm: tuple[float, float, float, float] | None
    intersection_mode: str  # "BBOX_OVERLAP", "POINTING_VECTOR", "DEFAULT_ROI", or "UNLOCKED"

    def to_dict(self) -> dict[str, Any]:
        return {
            "locked": self.locked,
            "marker_id": self.marker_id,
            "device_id": self.device_id,
            "hand_bbox_norm": [round(v, 4) for v in self.hand_bbox_norm],
            "anchor_bbox_norm": (
                [round(v, 4) for v in self.anchor_bbox_norm]
                if self.anchor_bbox_norm is not None
                else None
            ),
            "intersection_mode": self.intersection_mode,
        }


class ArucoSpatialAnchorTracker:
    """OpenCV `cv2.aruco` spatial marker detector and hand-to-anchor lock verifier."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        aruco_cfg = self.config.get("aruco", {})
        self.expand_margin: float = float(aruco_cfg.get("anchor_expand_margin", 0.12))

        self.marker_registry: dict[int, dict[str, Any]] = {}
        self.device_to_marker: dict[str, int] = {}
        raw_markers = aruco_cfg.get("markers", {})
        for k, spec in raw_markers.items():
            mid = int(spec.get("marker_id", k))
            dev_id = str(spec.get("device_id", "lamp"))
            bbox = list(spec.get("bbox", [0.15, 0.15, 0.85, 0.85]))
            entry = {
                "marker_id": mid,
                "device_id": dev_id,
                "label": str(spec.get("label", dev_id)),
                "bbox": (float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])),
            }
            self.marker_registry[mid] = entry
            self.device_to_marker[dev_id] = mid

        self._aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self._detector_params = cv2.aruco.DetectorParameters()
        self._detector = cv2.aruco.ArucoDetector(self._aruco_dict, self._detector_params)
        self._last_detections: dict[int, ArucoDetection] = {}

    def render_marker_image(self, marker_id: int, size_px: int = 80) -> np.ndarray:
        """Generate a valid binary ArUco marker image (`DICT_4X4_50`) using `cv2.aruco`."""
        marker_gray = cv2.aruco.generateImageMarker(self._aruco_dict, int(marker_id), int(size_px))
        bordered = cv2.copyMakeBorder(
            marker_gray, 10, 10, 10, 10, cv2.BORDER_CONSTANT, value=255
        )
        return cv2.cvtColor(bordered, cv2.COLOR_GRAY2BGR)

    def embed_marker_in_frame(
        self,
        frame_bgr: np.ndarray,
        marker_id: int,
        top_left_xy: tuple[int, int] = (24, 64),
        size_px: int = 72,
    ) -> np.ndarray:
        """Stamp a real OpenCV ArUco marker sticker onto a copy of `frame_bgr`."""
        canvas = frame_bgr.copy()
        patch = self.render_marker_image(marker_id, size_px=size_px)
        ph, pw = patch.shape[:2]
        x0, y0 = int(top_left_xy[0]), int(top_left_xy[1])
        h, w = canvas.shape[:2]
        if x0 + pw <= w and y0 + ph <= h and x0 >= 0 and y0 >= 0:
            canvas[y0 : y0 + ph, x0 : x0 + pw] = patch
        return canvas

    def detect_markers(self, frame_bgr_or_rgb: np.ndarray) -> list[ArucoDetection]:
        """Run `cv2.aruco.ArucoDetector.detectMarkers` on an image frame."""
        if frame_bgr_or_rgb is None or frame_bgr_or_rgb.size == 0:
            return []
        h, w = frame_bgr_or_rgb.shape[:2]
        gray = (
            cv2.cvtColor(frame_bgr_or_rgb, cv2.COLOR_BGR2GRAY)
            if frame_bgr_or_rgb.ndim == 3
            else frame_bgr_or_rgb
        )
        corners, ids, _ = self._detector.detectMarkers(gray)
        detections: list[ArucoDetection] = []
        self._last_detections.clear()
        if ids is None:
            return detections

        flat_ids = [int(x) for x in np.asarray(ids).reshape(-1)]
        for corner_arr, mid in zip(corners, flat_ids):
            pts = np.asarray(corner_arr).reshape(-1, 2)
            xs = [float(p[0]) / max(1.0, float(w)) for p in pts]
            ys = [float(p[1]) / max(1.0, float(h)) for p in pts]
            x_min = max(0.0, min(xs) - self.expand_margin)
            y_min = max(0.0, min(ys) - self.expand_margin)
            x_max = min(1.0, max(xs) + self.expand_margin)
            y_max = min(1.0, max(ys) + self.expand_margin)
            cx = 0.5 * (min(xs) + max(xs))
            cy = 0.5 * (min(ys) + max(ys))

            spec = self.marker_registry.get(
                mid,
                {"device_id": f"device_{mid}", "label": f"ArUco Marker {mid}"},
            )
            det = ArucoDetection(
                marker_id=mid,
                device_id=str(spec["device_id"]),
                label=str(spec["label"]),
                bbox_norm=(x_min, y_min, x_max, y_max),
                center_xy=(cx, cy),
            )
            detections.append(det)
            self._last_detections[mid] = det

        return detections

    @staticmethod
    def compute_hand_bbox(
        landmarks: list[tuple[float, float, float]] | None,
        wrist_xy: tuple[float, float] = (0.5, 0.5),
    ) -> tuple[float, float, float, float]:
        """Compute normalized (x_min, y_min, x_max, y_max) bounding box for a 21-point hand."""
        if landmarks and len(landmarks) > 0:
            xs = [float(pt[0]) for pt in landmarks]
            ys = [float(pt[1]) for pt in landmarks]
            return (min(xs), min(ys), max(xs), max(ys))
        wx, wy = float(wrist_xy[0]), float(wrist_xy[1])
        return (
            max(0.0, wx - 0.08),
            max(0.0, wy - 0.08),
            min(1.0, wx + 0.08),
            min(1.0, wy + 0.08),
        )

    @staticmethod
    def _boxes_intersect(
        a: tuple[float, float, float, float],
        b: tuple[float, float, float, float],
    ) -> bool:
        return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])

    @staticmethod
    def _pointing_ray_intersects_box(
        landmarks: list[tuple[float, float, float]] | None,
        box: tuple[float, float, float, float],
    ) -> bool:
        """Check if index finger ray (MCP[5] -> TIP[8]) points into the target anchor box."""
        if not landmarks or len(landmarks) < 9:
            return False
        mcp = landmarks[5]
        tip = landmarks[8]
        dx = float(tip[0]) - float(mcp[0])
        dy = float(tip[1]) - float(mcp[1])
        for scale in (0.0, 0.5, 1.0, 1.5, 2.0, 3.0):
            px = float(tip[0]) + dx * scale
            py = float(tip[1]) + dy * scale
            if box[0] <= px <= box[2] and box[1] <= py <= box[3]:
                return True
        return False

    def verify_spatial_anchor_lock(
        self,
        target_device: str,
        landmarks: list[tuple[float, float, float]] | None = None,
        wrist_xy: tuple[float, float] = (0.5, 0.5),
        explicit_marker_id: int | None = None,
        explicit_lock: bool | None = None,
    ) -> SpatialAnchorLockResult:
        """Verify whether the hand bounding box or pointing ray locks onto the ArUco marker anchor."""
        hand_bbox = self.compute_hand_bbox(landmarks, wrist_xy=wrist_xy)
        mid = (
            int(explicit_marker_id)
            if explicit_marker_id is not None
            else self.device_to_marker.get(target_device, 10)
        )
        spec = self.marker_registry.get(mid)
        resolved_device = str(spec["device_id"]) if spec else target_device

        if explicit_lock is False:
            anchor_box = spec["bbox"] if spec else None
            return SpatialAnchorLockResult(
                locked=False,
                marker_id=mid,
                device_id=resolved_device,
                hand_bbox_norm=hand_bbox,
                anchor_bbox_norm=anchor_box,
                intersection_mode="UNLOCKED",
            )

        if mid in self._last_detections:
            anchor_box = self._last_detections[mid].bbox_norm
        elif spec is not None:
            anchor_box = spec["bbox"]
        else:
            anchor_box = (0.10, 0.10, 0.90, 0.90)

        if explicit_lock is True:
            return SpatialAnchorLockResult(
                locked=True,
                marker_id=mid,
                device_id=resolved_device,
                hand_bbox_norm=hand_bbox,
                anchor_bbox_norm=anchor_box,
                intersection_mode="BBOX_OVERLAP",
            )

        if self._boxes_intersect(hand_bbox, anchor_box):
            return SpatialAnchorLockResult(
                locked=True,
                marker_id=mid,
                device_id=resolved_device,
                hand_bbox_norm=hand_bbox,
                anchor_bbox_norm=anchor_box,
                intersection_mode="BBOX_OVERLAP",
            )

        if self._pointing_ray_intersects_box(landmarks, anchor_box):
            return SpatialAnchorLockResult(
                locked=True,
                marker_id=mid,
                device_id=resolved_device,
                hand_bbox_norm=hand_bbox,
                anchor_bbox_norm=anchor_box,
                intersection_mode="POINTING_VECTOR",
            )

        return SpatialAnchorLockResult(
            locked=False,
            marker_id=mid,
            device_id=resolved_device,
            hand_bbox_norm=hand_bbox,
            anchor_bbox_norm=anchor_box,
            intersection_mode="UNLOCKED",
        )
