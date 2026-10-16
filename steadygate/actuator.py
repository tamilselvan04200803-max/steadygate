"""Virtual Actuator & Simulated Device Registry (`steadygate/actuator.py`).

Enforces explicit absolute SET commands (never TOGGLE), labels every feedback payload
with `"simulated"`, tracks `requested_state`, `applied_state`, and `simulated_observed_state`
separately (never reporting `"SUCCESS"` for a command that was only sent), supports
fault injection (`delay_ack` / `latency_spike_ms`, `drop_ack`, `duplicate`, `restart`,
`unknown_outcome`, `defective`), manages the auto-expiring ON timer for the HIGH-risk
`heater`, and enforces the Actuator Health Circuit Breaker (`DEVICE_FAULT_LOCK`).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from steadygate.config import load_config
from steadygate.events import ActionCommand, ReasonCode
from steadygate.recovery import CIRCUIT_BREAKER_ALERT_MESSAGE


@dataclass
class FaultInjectionConfig:
    """Fault injection settings for a simulated device."""

    drop_ack: bool = False
    unknown_outcome: bool = False
    latency_spike_ms: int = 0
    duplicate_packet: bool = False
    defective: bool = False
    unacknowledged_fault: bool = False


@dataclass
class VirtualDevice:
    """State container for a simulated home device with tri-state telemetry."""

    device_id: str
    name: str
    risk_tier: str
    state: str
    allowed_commands: list[str]
    aruco_marker_id: int = 10
    ampere_rating: float = 0.15
    load_ampere_class: str = "LOW_AMPERE"
    load_ampere_class_baseline: float = 0.35
    auto_expire_sec: float | None = None
    requested_state: str = "OFF"
    applied_state: str = "OFF"
    simulated_observed_state: str = "OFF"
    last_command: str | None = None
    last_updated_mono: float | None = None
    on_since_mono: float | None = None
    status_register: str = "OK"
    fault: FaultInjectionConfig = field(default_factory=FaultInjectionConfig)

    @property
    def is_defective_or_faulted(self) -> bool:
        return (
            self.status_register == "DEFECTIVE"
            or self.state == "DEFECTIVE"
            or self.fault.defective
            or self.fault.unacknowledged_fault
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "device_id": self.device_id,
            "name": self.name,
            "aruco_marker_id": self.aruco_marker_id,
            "ampere_rating": self.ampere_rating,
            "load_ampere_class": self.load_ampere_class,
            "load_ampere_class_baseline": self.load_ampere_class_baseline,
            "risk_tier": self.risk_tier,
            "state": self.state,
            "requested_state": self.requested_state,
            "applied_state": self.applied_state,
            "simulated_observed_state": self.simulated_observed_state,
            "auto_expire_sec": self.auto_expire_sec,
            "on_since_mono": self.on_since_mono,
            "status_register": (
                "DEFECTIVE" if self.is_defective_or_faulted else self.status_register
            ),
            "allowed_commands": list(self.allowed_commands),
            "last_command": self.last_command,
            "last_updated_mono": self.last_updated_mono,
            "simulated": True,
            "label": "simulated",
            "feedback_mode": "simulated",
            "fault": {
                "drop_ack": self.fault.drop_ack,
                "unknown_outcome": self.fault.unknown_outcome,
                "latency_spike_ms": self.fault.latency_spike_ms,
                "duplicate_packet": self.fault.duplicate_packet,
                "defective": self.fault.defective,
                "unacknowledged_fault": self.fault.unacknowledged_fault,
            },
        }


@dataclass(frozen=True)
class ActuationResult:
    """Result returned by VirtualActuator.execute()."""

    ok: bool
    device_id: str
    command: str
    previous_state: str
    current_state: str
    requested_state: str = "OFF"
    applied_state: str = "OFF"
    simulated_observed_state: str = "OFF"
    reason_code: str | None = None
    latency_ms: int = 0
    simulated: bool = True
    label: str = "simulated"
    feedback_mode: str = "simulated"
    alert_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "device_id": self.device_id,
            "command": self.command,
            "previous_state": self.previous_state,
            "current_state": self.current_state,
            "requested_state": self.requested_state,
            "applied_state": self.applied_state,
            "simulated_observed_state": self.simulated_observed_state,
            "reason_code": self.reason_code,
            "latency_ms": self.latency_ms,
            "simulated": True,
            "label": "simulated",
            "feedback_mode": "simulated",
            "alert_message": self.alert_message,
        }


ActuatorFeedback = ActuationResult

COMMAND_TO_STATE: dict[str, str] = {
    "SET_ON": "ON",
    "SET_OFF": "OFF",
    "SET_OPEN": "OPEN",
    "SET_CLOSED": "CLOSED",
    "SET_SPEED_1": "SPEED_1",
    "SET_SPEED_2": "SPEED_2",
    "SET_SPEED_3": "SPEED_3",
}


class VirtualActuator:
    """Manages simulated devices (`lamp`, `lamp_2`, `fan`, `curtain`, `heater`) with fault injection and circuit breaker."""

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        self.config = config or load_config()
        self.devices: dict[str, VirtualDevice] = {}
        self.history: list[dict[str, Any]] = []
        self._adapters: list[Any] = []
        self._init_devices()

    def _init_devices(self) -> None:
        dev_cfg = self.config.get("devices", {})
        for dev_id, spec in dev_cfg.items():
            default_st = str(spec.get("default_state", "OFF"))
            self.devices[dev_id] = VirtualDevice(
                device_id=str(spec.get("device_id", dev_id)),
                name=str(spec.get("name", dev_id.title())),
                risk_tier=str(spec.get("risk_tier", "LOW")),
                state=default_st,
                requested_state=default_st,
                applied_state=default_st,
                simulated_observed_state=default_st,
                aruco_marker_id=int(spec.get("aruco_marker_id", 10)),
                ampere_rating=float(spec.get("ampere_rating", 0.15)),
                load_ampere_class=str(spec.get("load_ampere_class", "LOW_AMPERE")),
                load_ampere_class_baseline=float(
                    spec.get("load_ampere_class_baseline", 0.35)
                ),
                auto_expire_sec=(
                    float(spec["auto_expire_sec"])
                    if spec.get("auto_expire_sec") is not None
                    else None
                ),
                allowed_commands=list(spec.get("allowed_commands", ["SET_ON", "SET_OFF"])),
            )

    def register_adapter(self, adapter: Any) -> None:
        """Register an output adapter (e.g., offline WebhookAdapter stub)."""
        self._adapters.append(adapter)

    def get_device(self, device_id: str) -> VirtualDevice:
        if device_id not in self.devices:
            raise KeyError(f"Unknown simulated device '{device_id}'.")
        return self.devices[device_id]

    def check_auto_expire(self, t_mono: float) -> list[str]:
        """Auto-expire HIGH-risk appliances (e.g., heater) whose ON timer has elapsed."""
        expired: list[str] = []
        for dev in self.devices.values():
            if (
                dev.auto_expire_sec is not None
                and dev.state == "ON"
                and dev.on_since_mono is not None
                and (t_mono - dev.on_since_mono) >= dev.auto_expire_sec
            ):
                dev.state = "OFF"
                dev.applied_state = "OFF"
                dev.simulated_observed_state = "OFF"
                dev.on_since_mono = None
                dev.last_updated_mono = t_mono
                expired.append(dev.device_id)
        return expired

    def inject_fault(
        self,
        device_id: str | None = None,
        drop_ack: bool | None = None,
        unknown_outcome: bool | None = None,
        latency_spike_ms: int | float | None = None,
        duplicate_packet: bool | None = None,
        defective: bool | None = None,
        unacknowledged_fault: bool | None = None,
        restart: bool | None = None,
    ) -> dict[str, Any]:
        """Configure fault injection on a target virtual device (or all devices if device_id is None)."""
        target_ids = [device_id] if device_id is not None else list(self.devices.keys())
        last_dict: dict[str, Any] = {}
        for tid in target_ids:
            dev = self.get_device(tid)
            if restart:
                default_st = str(
                    self.config.get("devices", {}).get(tid, {}).get("default_state", "OFF")
                )
                dev.state = default_st
                dev.requested_state = default_st
                dev.applied_state = default_st
                dev.simulated_observed_state = default_st
                dev.on_since_mono = None
                dev.fault = FaultInjectionConfig()
                dev.status_register = "OK"
            if drop_ack is not None:
                dev.fault.drop_ack = bool(drop_ack)
            if unknown_outcome is not None:
                dev.fault.unknown_outcome = bool(unknown_outcome)
            if latency_spike_ms is not None:
                dev.fault.latency_spike_ms = max(0, int(latency_spike_ms))
            if duplicate_packet is not None:
                dev.fault.duplicate_packet = bool(duplicate_packet)
            if defective is not None:
                dev.fault.defective = bool(defective)
                dev.status_register = "DEFECTIVE" if dev.fault.defective else "OK"
            if unacknowledged_fault is not None:
                dev.fault.unacknowledged_fault = bool(unacknowledged_fault)
            last_dict = dev.to_dict()
        return last_dict

    def set_fault(
        self,
        device_id: str | None = None,
        *,
        drop_ack: bool | None = None,
        unknown_outcome: bool | None = None,
        latency_spike_ms: int | float | None = None,
        duplicate_packet: bool | None = None,
        defective: bool | None = None,
        unacknowledged_fault: bool | None = None,
        restart: bool | None = None,
    ) -> dict[str, Any]:
        """Alias for inject_fault supporting keyword fault configuration."""
        return self.inject_fault(
            device_id,
            drop_ack=drop_ack,
            unknown_outcome=unknown_outcome,
            latency_spike_ms=latency_spike_ms,
            duplicate_packet=duplicate_packet,
            defective=defective,
            unacknowledged_fault=unacknowledged_fault,
            restart=restart,
        )

    def clear_faults(self) -> None:
        """Clear all fault injection flags across all virtual devices."""
        for dev in self.devices.values():
            dev.fault = FaultInjectionConfig()
            dev.status_register = "OK"

    def set_device_defective(
        self,
        device_id: str,
        defective: bool = True,
        unacknowledged_fault: bool = True,
    ) -> dict[str, Any]:
        """Set or clear the DEFECTIVE status flag and unacknowledged fault register on a device."""
        dev = self.get_device(device_id)
        dev.fault.defective = bool(defective)
        dev.fault.unacknowledged_fault = bool(unacknowledged_fault)
        dev.status_register = "DEFECTIVE" if (defective or unacknowledged_fault) else "OK"
        return dev.to_dict()

    def acknowledge_fault(self, device_id: str) -> dict[str, Any]:
        """Clear unacknowledged fault and restore device status register to OK."""
        dev = self.get_device(device_id)
        dev.fault.defective = False
        dev.fault.unacknowledged_fault = False
        dev.status_register = "OK"
        if dev.state in ("UNKNOWN", "DEFECTIVE"):
            dev.state = "OFF"
            dev.applied_state = "OFF"
            dev.simulated_observed_state = "OFF"
        return dev.to_dict()

    def check_circuit_breaker(self, device_id: str) -> tuple[bool, str | None]:
        """Query the simulated status register of the target appliance prior to SET execution."""
        dev = self.get_device(device_id)
        if dev.is_defective_or_faulted:
            return (True, CIRCUIT_BREAKER_ALERT_MESSAGE)
        return (False, None)

    def execute(self, action: ActionCommand, t_mono: float = 0.0) -> ActuationResult:
        """Execute an explicit SET ActionCommand against a virtual device."""
        if "TOGGLE" in action.command.upper() or not action.command.startswith("SET_"):
            raise ValueError(
                f"Illegal actuator command '{action.command}': only explicit SET_* commands are allowed."
            )

        self.check_auto_expire(t_mono)
        dev = self.get_device(action.device_id)
        if action.command not in dev.allowed_commands:
            raise ValueError(
                f"Command '{action.command}' is not permitted for device '{dev.device_id}' "
                f"(allowed: {dev.allowed_commands})."
            )

        prev_state = dev.state
        desired_state = COMMAND_TO_STATE.get(action.command, action.target_state)
        dev.requested_state = desired_state
        latency_ms = dev.fault.latency_spike_ms

        # Circuit breaker check before physical change packet
        tripped, alert_msg = self.check_circuit_breaker(dev.device_id)
        if tripped:
            res = ActuationResult(
                ok=False,
                device_id=dev.device_id,
                command=action.command,
                previous_state=prev_state,
                current_state=dev.state,
                requested_state=desired_state,
                applied_state=dev.applied_state,
                simulated_observed_state=dev.simulated_observed_state,
                reason_code=ReasonCode.DEVICE_FAULT_LOCK.value,
                latency_ms=latency_ms,
                alert_message=alert_msg,
            )
            self.history.append(res.to_dict())
            return res

        if dev.fault.drop_ack:
            # Fault mode 1: ACK timeout — requested_state was sent, but applied/observed remain unchanged
            res = ActuationResult(
                ok=False,
                device_id=dev.device_id,
                command=action.command,
                previous_state=prev_state,
                current_state=prev_state,
                requested_state=desired_state,
                applied_state=dev.applied_state,
                simulated_observed_state=dev.simulated_observed_state,
                reason_code=ReasonCode.ACK_MISSING.value,
                latency_ms=latency_ms,
            )
            self.history.append(res.to_dict())
            return res

        if dev.fault.unknown_outcome:
            # Fault mode 2: Corrupt/unknown outcome — applied_state updated, observed is UNKNOWN
            dev.state = "UNKNOWN"
            dev.applied_state = desired_state
            dev.simulated_observed_state = "UNKNOWN"
            dev.last_command = action.command
            dev.last_updated_mono = t_mono
            res = ActuationResult(
                ok=False,
                device_id=dev.device_id,
                command=action.command,
                previous_state=prev_state,
                current_state="UNKNOWN",
                requested_state=desired_state,
                applied_state=desired_state,
                simulated_observed_state="UNKNOWN",
                reason_code=ReasonCode.OUTCOME_UNKNOWN.value,
                latency_ms=latency_ms,
            )
            self.history.append(res.to_dict())
            return res

        # Apply idempotent SET state (even if duplicate_packet is True, SET is idempotent!)
        dev.state = desired_state
        dev.applied_state = desired_state
        dev.simulated_observed_state = desired_state
        dev.last_command = action.command
        dev.last_updated_mono = t_mono
        if desired_state == "ON":
            dev.on_since_mono = t_mono
        elif desired_state == "OFF":
            dev.on_since_mono = None

        res = ActuationResult(
            ok=True,
            device_id=dev.device_id,
            command=action.command,
            previous_state=prev_state,
            current_state=desired_state,
            requested_state=desired_state,
            applied_state=desired_state,
            simulated_observed_state=desired_state,
            reason_code=None,
            latency_ms=latency_ms,
        )
        self.history.append(res.to_dict())
        for adapter in self._adapters:
            if hasattr(adapter, "emit"):
                adapter.emit(action, res)
        return res

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Return a serializable snapshot of all simulated devices."""
        return {dev_id: dev.to_dict() for dev_id, dev in self.devices.items()}
