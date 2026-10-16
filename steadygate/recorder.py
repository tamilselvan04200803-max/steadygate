"""Flight Recorder: Streams DecisionEvent JSONL records with embedded ml_training_payload
to logs/session_<timestamp>.jsonl while enforcing the raw-pixel privacy safeguard.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from steadygate import REPO_ROOT
from steadygate.config import is_feature_enabled, load_config
from steadygate.events import DecisionEvent


class FlightRecorder:
    """Streams validated DecisionEvent records (with privacy-safe ml_training_payload) to a local JSONL file."""

    def __init__(
        self,
        config: dict[str, Any] | None = None,
        session_path: Path | str | None = None,
        session_tag: str | None = None,
    ) -> None:
        self.config = config or load_config()
        self.enabled = is_feature_enabled(self.config, "flight_recorder")
        self.ml_pipeline_enabled = is_feature_enabled(
            self.config, "ml_training_pipeline"
        ) or True

        logs_rel = self.config.get("paths", {}).get("logs_dir", "logs")
        self.logs_dir = (REPO_ROOT / Path(logs_rel)).resolve()
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        if session_path is not None:
            p = Path(session_path)
            self.session_path = p if p.is_absolute() else (REPO_ROOT / p).resolve()
            self.session_path.parent.mkdir(parents=True, exist_ok=True)
        else:
            ts = session_tag or datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
            self.session_path = self.logs_dir / f"session_{ts}.jsonl"

        self.events_written: int = 0
        self._fh = self.session_path.open("a", encoding="utf-8") if self.enabled else None

    def record(self, event: DecisionEvent) -> None:
        """Write a single DecisionEvent line with nested ml_training_payload to the session JSONL file."""
        if not self.enabled or self._fh is None:
            return
        ml_payload = event.get_ml_training_payload()
        privacy = ml_payload.get("privacy_safeguard", {})
        if not privacy.get("raw_video_pixels_masked", False) or privacy.get(
            "pixel_array_stored", True
        ):
            raise RuntimeError(
                "PRIVACY SAFEGUARD VIOLATION: Raw video pixels must be masked and stripped before writing to session JSONL."
            )
        self._fh.write(event.to_jsonl(include_ml_payload=True) + "\n")
        self._fh.flush()
        self.events_written += 1

    def close(self) -> None:
        if self._fh is not None and not self._fh.closed:
            self._fh.close()

    def __enter__(self) -> FlightRecorder:
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.close()


def load_session_events(log_path: Path | str) -> list[DecisionEvent]:
    """Load and validate all DecisionEvent records from a JSONL file."""
    path = Path(log_path)
    if not path.is_absolute():
        path = (REPO_ROOT / path).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Session log file not found: {path}")

    events: list[DecisionEvent] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            events.append(DecisionEvent.from_jsonl(stripped))
        except Exception as exc:
            raise ValueError(f"Invalid DecisionEvent at {path}:{line_no}: {exc}") from exc
    return events


def latest_session_path(logs_dir: Path | str | None = None) -> Path:
    """Return the most recently modified session_*.jsonl file in logs/."""
    base = Path(logs_dir) if logs_dir is not None else (REPO_ROOT / "logs")
    if not base.is_absolute():
        base = (REPO_ROOT / base).resolve()
    candidates = sorted(base.glob("session_*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise FileNotFoundError(f"No session_*.jsonl files found in {base}")
    return candidates[0]
