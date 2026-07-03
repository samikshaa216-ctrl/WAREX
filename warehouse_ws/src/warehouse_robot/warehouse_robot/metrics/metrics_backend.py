"""
Publication-Grade Metrics Backend
MTTR, MTBF, throughput, deadline rates. Thread-safe singleton.
"""
import time
import threading
import statistics
from collections import deque
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any


@dataclass
class RobotMetrics:
    robot_id:           str
    total_tasks:        int   = 0
    tasks_completed:    int   = 0
    tasks_crashed:      int   = 0
    tasks_timed_out:    int   = 0
    deadlines_met:      int   = 0
    deadlines_missed:   int   = 0
    total_uptime_s:     float = 0.0
    total_downtime_s:   float = 0.0
    crash_count:        int   = 0
    last_crash_time:    Optional[float] = None
    last_recovery_time: Optional[float] = None
    battery_readings:   List[float] = field(default_factory=list)
    task_durations_s:   List[float] = field(default_factory=list)

    @property
    def mtbf(self):
        return float('inf') if self.crash_count == 0 else self.total_uptime_s / self.crash_count

    @property
    def mttr(self):
        return 0.0 if self.crash_count == 0 else self.total_downtime_s / self.crash_count

    @property
    def availability(self):
        t = self.total_uptime_s + self.total_downtime_s
        return 1.0 if t == 0 else self.total_uptime_s / t

    @property
    def deadline_success_rate(self):
        t = self.deadlines_met + self.deadlines_missed
        return 1.0 if t == 0 else self.deadlines_met / t

    @property
    def avg_task_duration(self):
        return statistics.mean(self.task_durations_s) if self.task_durations_s else 0.0

    @property
    def avg_battery(self):
        readings = self.battery_readings[-50:]
        return statistics.mean(readings) if readings else 100.0

    def to_dict(self):
        return {
            'robot_id':            self.robot_id,
            'total_tasks':         self.total_tasks,
            'tasks_completed':     self.tasks_completed,
            'tasks_crashed':       self.tasks_crashed,
            'tasks_timed_out':     self.tasks_timed_out,
            'deadlines_met':       self.deadlines_met,
            'deadlines_missed':    self.deadlines_missed,
            'crash_count':         self.crash_count,
            'mtbf_s':              round(self.mtbf, 2) if self.mtbf != float('inf') else 99999,
            'mttr_s':              round(self.mttr, 2),
            'availability_pct':    round(self.availability * 100, 2),
            'deadline_success_pct': round(self.deadline_success_rate * 100, 2),
            'avg_task_duration_s': round(self.avg_task_duration, 2),
            'avg_battery_pct':     round(self.avg_battery, 1),
        }


@dataclass
class SystemMetrics:
    experiment_start:       float = field(default_factory=time.time)
    total_tasks_generated:  int   = 0
    total_tasks_completed:  int   = 0
    total_tasks_failed:     int   = 0
    total_crashes:          int   = 0
    total_recoveries:       int   = 0
    _window: deque = field(default_factory=lambda: deque(maxlen=60))

    @property
    def elapsed_s(self):
        return time.time() - self.experiment_start

    @property
    def throughput_per_minute(self):
        if len(self._window) < 2:
            return 0.0
        span = self._window[-1] - self._window[0]
        return (len(self._window) / span) * 60.0 if span > 0 else 0.0

    @property
    def overall_deadline_rate(self):
        t = self.total_tasks_completed + self.total_tasks_failed
        return 1.0 if t == 0 else self.total_tasks_completed / t

    def record_completion(self):
        self._window.append(time.time())

    def to_dict(self):
        return {
            'elapsed_s':             round(self.elapsed_s, 1),
            'total_tasks_generated': self.total_tasks_generated,
            'total_tasks_completed': self.total_tasks_completed,
            'total_tasks_failed':    self.total_tasks_failed,
            'total_crashes':         self.total_crashes,
            'total_recoveries':      self.total_recoveries,
            'throughput_per_minute': round(self.throughput_per_minute, 2),
            'overall_deadline_rate': round(self.overall_deadline_rate * 100, 2),
        }


class MetricsBackend:
    def __init__(self):
        self._lock    = threading.Lock()
        self.system   = SystemMetrics()
        self.robots:  Dict[str, RobotMetrics] = {}
        self._started: Dict[str, float] = {}
        self._crashed: Dict[str, float] = {}

    def register_robot(self, robot_id: str):
        with self._lock:
            if robot_id not in self.robots:
                self.robots[robot_id]   = RobotMetrics(robot_id=robot_id)
                self._started[robot_id] = time.time()

    def record_crash(self, robot_id: str):
        with self._lock:
            self._ensure(robot_id)
            r = self.robots[robot_id]
            r.crash_count   += 1
            r.tasks_crashed += 1
            r.last_crash_time = time.time()
            self.system.total_crashes += 1
            if robot_id in self._started:
                r.total_uptime_s += time.time() - self._started.pop(robot_id)
            self._crashed[robot_id] = time.time()

    def record_recovery(self, robot_id: str):
        with self._lock:
            self._ensure(robot_id)
            r = self.robots[robot_id]
            r.last_recovery_time = time.time()
            self.system.total_recoveries += 1
            if robot_id in self._crashed:
                r.total_downtime_s += time.time() - self._crashed.pop(robot_id)
            self._started[robot_id] = time.time()

    def record_task_generated(self):
        with self._lock:
            self.system.total_tasks_generated += 1

    def record_task_completed(self, robot_id: str, duration_s: float, deadline_met: bool):
        with self._lock:
            self._ensure(robot_id)
            r = self.robots[robot_id]
            r.total_tasks     += 1
            r.tasks_completed += 1
            r.task_durations_s.append(duration_s)
            if deadline_met:
                r.deadlines_met           += 1
                self.system.total_tasks_completed += 1
            else:
                r.deadlines_missed        += 1
                self.system.total_tasks_failed    += 1
            self.system.record_completion()

    def record_task_timeout(self, robot_id: str):
        with self._lock:
            self._ensure(robot_id)
            self.robots[robot_id].tasks_timed_out += 1
            self.system.total_tasks_failed        += 1

    def record_battery(self, robot_id: str, level: float):
        with self._lock:
            self._ensure(robot_id)
            self.robots[robot_id].battery_readings.append(level)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            now = time.time()
            for rid, t in list(self._started.items()):
                if rid in self.robots:
                    self.robots[rid].total_uptime_s += now - t
                    self._started[rid] = now
            return {
                'system': self.system.to_dict(),
                'robots': {rid: r.to_dict() for rid, r in self.robots.items()},
            }

    def fleet_mttr(self) -> float:
        with self._lock:
            vals = [r.mttr for r in self.robots.values() if r.crash_count > 0]
        return statistics.mean(vals) if vals else 0.0

    def fleet_mtbf(self) -> float:
        with self._lock:
            vals = [r.mtbf for r in self.robots.values()
                    if r.crash_count > 0 and r.mtbf != float('inf')]
        return statistics.mean(vals) if vals else float('inf')

    def _ensure(self, robot_id: str):
        if robot_id not in self.robots:
            self.robots[robot_id]   = RobotMetrics(robot_id=robot_id)
            self._started[robot_id] = time.time()


_backend: Optional[MetricsBackend] = None


def get_metrics() -> MetricsBackend:
    global _backend
    if _backend is None:
        _backend = MetricsBackend()
    return _backend