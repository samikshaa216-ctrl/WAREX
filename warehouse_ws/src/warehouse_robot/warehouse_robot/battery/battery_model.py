"""
Realistic Li-ion Battery Model
Discharge rates, temperature, health degradation, predictive estimation.
"""
import time
from dataclasses import dataclass, asdict
from typing import Dict, Any, Optional
from enum import Enum


class RobotState(Enum):
    IDLE     = 'idle'
    MOVING   = 'moving'
    CARRYING = 'carrying'
    CHARGING = 'charging'
    CRASHED  = 'crashed'


@dataclass
class BatteryState:
    level:           float  # 0–100 %
    voltage:         float  # Volts
    current:         float  # Amps (negative = discharging)
    temperature:     float  # Celsius
    health:          float  # 0–100 %
    charge_cycles:   int
    total_discharge_ah: float
    time_to_empty:   float  # seconds
    time_to_full:    float  # seconds
    is_charging:     bool
    is_critical:     bool

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class BatteryModel:

    def __init__(self, config: Optional[Dict[str, Any]] = None):
        config = config or {}
        self.NOMINAL_VOLTAGE         = config.get('nominal_voltage', 48.0)
        self.CAPACITY_AH             = config.get('capacity_ah', 50.0)
        self.INITIAL_LEVEL           = config.get('initial_level', 100.0)
        self.DISCHARGE_RATE_IDLE     = config.get('discharge_rate_idle', 0.5)
        self.DISCHARGE_RATE_MOVING   = config.get('discharge_rate_moving', 2.0)
        self.DISCHARGE_RATE_CARRYING = config.get('discharge_rate_carrying', 3.5)
        self.CHARGE_RATE             = config.get('charge_rate', 10.0)
        self.CRITICAL_THRESHOLD      = config.get('critical_threshold', 20.0)
        self.LOW_THRESHOLD           = config.get('low_threshold', 40.0)
        self.CYCLE_DEGRADATION       = 0.01    # health % per cycle
        self.TEMP_DEG_THRESHOLD      = 40.0
        self.TEMP_DEG_RATE           = 0.001
        self.AMBIENT_TEMP            = 25.0
        self.MAX_TEMP                = 45.0
        self.THERMAL_TC              = 60.0

        self.state = BatteryState(
            level=self.INITIAL_LEVEL,
            voltage=self._calc_voltage(self.INITIAL_LEVEL),
            current=0.0,
            temperature=self.AMBIENT_TEMP,
            health=100.0,
            charge_cycles=0,
            total_discharge_ah=0.0,
            time_to_empty=float('inf'),
            time_to_full=0.0,
            is_charging=False,
            is_critical=False,
        )

    def update(self, dt: float, robot_state: RobotState,
               carrying_load: bool = False) -> BatteryState:
        if robot_state == RobotState.CHARGING:
            self._charge(dt)
        elif robot_state == RobotState.CRASHED:
            self._discharge(dt, self.DISCHARGE_RATE_IDLE * 0.1)
        else:
            if robot_state == RobotState.IDLE:
                rate = self.DISCHARGE_RATE_IDLE
            elif robot_state in (RobotState.CARRYING,) or carrying_load:
                rate = self.DISCHARGE_RATE_CARRYING
            else:
                rate = self.DISCHARGE_RATE_MOVING
            self._discharge(dt, rate)

        self._update_temperature(dt, robot_state)
        self._update_health(dt)
        self._update_predictions()
        self.state.is_critical = self.state.level < self.CRITICAL_THRESHOLD
        return self.state

    def _discharge(self, dt: float, base_rate: float):
        hf   = 1.0 + (100.0 - self.state.health) / 100.0
        rate = base_rate * hf
        ah   = rate * (dt / 3600.0)
        self.state.total_discharge_ah += ah
        self.state.level   = max(0.0, self.state.level - (ah / self.CAPACITY_AH) * 100.0)
        self.state.voltage  = self._calc_voltage(self.state.level)
        self.state.current  = -rate
        self.state.is_charging = False

    def _charge(self, dt: float):
        rate = (self.CHARGE_RATE * (100.0 - self.state.level) / 10.0
                if self.state.level > 90.0 else self.CHARGE_RATE)
        ah   = rate * (dt / 3600.0)
        old  = self.state.level
        self.state.level   = min(100.0, self.state.level + (ah / self.CAPACITY_AH) * 100.0)
        if old < 100.0 and self.state.level == 100.0:
            self.state.charge_cycles += 1
            self.state.health = max(0.0, self.state.health - self.CYCLE_DEGRADATION)
        self.state.voltage  = self._calc_voltage(self.state.level)
        self.state.current  = rate
        self.state.is_charging = True

    def _update_temperature(self, dt: float, robot_state: RobotState):
        heat = (0.1 if robot_state == RobotState.CHARGING
                else 0.05 if robot_state in (RobotState.MOVING, RobotState.CARRYING)
                else 0.0)
        diff    = self.state.temperature - self.AMBIENT_TEMP
        cooling = -diff / self.THERMAL_TC
        self.state.temperature = max(
            self.AMBIENT_TEMP,
            min(self.MAX_TEMP, self.state.temperature + (heat + cooling) * dt)
        )

    def _update_health(self, dt: float):
        if self.state.temperature > self.TEMP_DEG_THRESHOLD:
            excess = self.state.temperature - self.TEMP_DEG_THRESHOLD
            self.state.health = max(0.0, self.state.health - self.TEMP_DEG_RATE * excess * dt)

    def _calc_voltage(self, level: float) -> float:
        n = level / 100.0
        vf = 0.8 + 0.2 * n if n > 0.2 else 0.8 * (n / 0.2)
        return self.NOMINAL_VOLTAGE * vf

    def _update_predictions(self):
        if self.state.is_charging:
            if self.state.current > 0:
                rem_ah = self.CAPACITY_AH * (100.0 - self.state.level) / 100.0
                self.state.time_to_full  = (rem_ah / self.state.current) * 3600.0
            self.state.time_to_empty = float('inf')
        else:
            if abs(self.state.current) > 0:
                rem_ah = self.CAPACITY_AH * self.state.level / 100.0
                self.state.time_to_empty = (rem_ah / abs(self.state.current)) * 3600.0
            self.state.time_to_full = 0.0

    def estimate_drain(self, task_duration: float, task_type: str) -> float:
        if task_type in ('PICKUP', 'DELIVER', 'TRANSPORT'):
            ah = (self.DISCHARGE_RATE_MOVING * task_duration * 0.7 +
                  self.DISCHARGE_RATE_CARRYING * task_duration * 0.5 +
                  self.DISCHARGE_RATE_IDLE * task_duration * 0.3) / 3600.0
        else:
            ah = self.DISCHARGE_RATE_MOVING * task_duration / 3600.0
        hf = 1.0 + (100.0 - self.state.health) / 100.0
        return (ah * hf / self.CAPACITY_AH) * 100.0

    def can_complete_task(self, duration: float, task_type: str,
                          safety_margin: float = 15.0) -> bool:
        return (self.state.level - self.estimate_drain(duration, task_type)) >= safety_margin

    def get_snapshot(self) -> BatteryState:
        from dataclasses import asdict
        return BatteryState(**asdict(self.state))