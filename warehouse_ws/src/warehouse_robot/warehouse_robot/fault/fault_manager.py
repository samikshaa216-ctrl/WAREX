"""
Fault Manager — crash detection, recovery orchestration, MTTR/MTBF tracking.
"""
import time
import threading
import logging
from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable, Any

log = logging.getLogger(__name__)


class FaultType(Enum):
    CRASH        = 'CRASH'
    TIMEOUT      = 'TIMEOUT'
    BATTERY_DEAD = 'BATTERY_DEAD'
    NETWORK_LOST = 'NETWORK_LOST'


class RecoveryState(Enum):
    HEALTHY    = 'HEALTHY'
    FAULTED    = 'FAULTED'
    RECOVERING = 'RECOVERING'
    DEGRADED   = 'DEGRADED'


@dataclass
class FaultEvent:
    robot_id:   str
    fault_type: FaultType
    timestamp:  float
    task_id:    Optional[str]
    details:    str = ''


@dataclass
class RecoveryRecord:
    robot_id:       str
    fault_event:    FaultEvent
    recovery_state: RecoveryState = RecoveryState.FAULTED
    recovery_start: Optional[float] = None
    recovery_end:   Optional[float] = None
    retry_count:    int = 0

    @property
    def recovery_duration(self):
        if self.recovery_start and self.recovery_end:
            return self.recovery_end - self.recovery_start
        return None


class FaultManager:

    def __init__(self, max_retries: int = 3,
                 recovery_timeout: float = 15.0,
                 heartbeat_timeout: float = 8.0):
        self.max_retries       = max_retries
        self.recovery_timeout  = recovery_timeout
        self.heartbeat_timeout = heartbeat_timeout
        self._lock    = threading.Lock()
        self._records:  Dict[str, RecoveryRecord] = {}
        self._history:  List[FaultEvent]          = []
        self._hb_times: Dict[str, float]          = {}

        self.on_fault:    Optional[Callable] = None
        self.on_recovery: Optional[Callable] = None

        self._watchdog = threading.Thread(target=self._watchdog_loop, daemon=True)
        self._watchdog.start()

    def update_heartbeat(self, robot_id: str):
        with self._lock:
            self._hb_times[robot_id] = time.time()
            if robot_id in self._records:
                if self._records[robot_id].recovery_state == RecoveryState.RECOVERING:
                    self._complete_recovery_locked(robot_id)

    def report_fault(self, robot_id: str, fault_type: FaultType,
                     task_id: Optional[str] = None, details: str = ''):
        with self._lock:
            if robot_id in self._records:
                if self._records[robot_id].recovery_state == RecoveryState.FAULTED:
                    return
            event = FaultEvent(robot_id=robot_id, fault_type=fault_type,
                               timestamp=time.time(), task_id=task_id, details=details)
            self._history.append(event)
            self._records[robot_id] = RecoveryRecord(
                robot_id=robot_id, fault_event=event,
                recovery_state=RecoveryState.RECOVERING,
                recovery_start=time.time())
        log.error(f'[FAULT] {robot_id} | {fault_type.value} | task={task_id} | {details}')
        if self.on_fault:
            try:
                self.on_fault(robot_id, fault_type, task_id)
            except Exception as e:
                log.exception(f'on_fault callback error: {e}')

    def report_recovery(self, robot_id: str):
        with self._lock:
            self._complete_recovery_locked(robot_id)

    def robot_state(self, robot_id: str) -> RecoveryState:
        with self._lock:
            return (self._records[robot_id].recovery_state
                    if robot_id in self._records else RecoveryState.HEALTHY)

    def is_healthy(self, robot_id: str) -> bool:
        return self.robot_state(robot_id) == RecoveryState.HEALTHY

    def fault_summary(self) -> Dict[str, Any]:
        with self._lock:
            return {rid: {
                'state':      rec.recovery_state.value,
                'fault_type': rec.fault_event.fault_type.value,
                'task_id':    rec.fault_event.task_id,
                'retry_count': rec.retry_count,
                'duration_s':  rec.recovery_duration,
            } for rid, rec in self._records.items()}

    def recent_faults(self, n: int = 20) -> List[Dict[str, Any]]:
        with self._lock:
            events = self._history[-n:]
        return [{'robot_id': e.robot_id, 'fault_type': e.fault_type.value,
                 'timestamp': e.timestamp, 'task_id': e.task_id,
                 'details': e.details} for e in events]

    def fleet_stats(self) -> Dict[str, Any]:
        with self._lock:
            by_type: Dict[str, int] = {}
            for e in self._history:
                by_type[e.fault_type.value] = by_type.get(e.fault_type.value, 0) + 1
            active = sum(1 for r in self._records.values()
                         if r.recovery_state in (RecoveryState.FAULTED,
                                                  RecoveryState.RECOVERING))
            return {'total_faults': len(self._history),
                    'by_type': by_type, 'active_faults': active}

    def _complete_recovery_locked(self, robot_id: str):
        if robot_id not in self._records:
            return
        rec             = self._records[robot_id]
        rec.recovery_end   = time.time()
        rec.recovery_state = RecoveryState.HEALTHY
        dur = rec.recovery_duration or 0.0
        log.info(f'[RECOVERY] {robot_id} recovered in {dur:.1f}s')
        del self._records[robot_id]
        if self.on_recovery:
            try:
                self.on_recovery(robot_id)
            except Exception as e:
                log.exception(f'on_recovery callback error: {e}')

    def _watchdog_loop(self):
        while True:
            time.sleep(1.0)
            now       = time.time()
            to_fault  = []
            with self._lock:
                for rid, rec in list(self._records.items()):
                    if rec.recovery_state == RecoveryState.RECOVERING:
                        age = now - (rec.recovery_start or now)
                        if age > self.recovery_timeout:
                            rec.retry_count += 1
                            if rec.retry_count >= self.max_retries:
                                rec.recovery_state = RecoveryState.DEGRADED
                            else:
                                rec.recovery_start = now
                for rid, last_hb in list(self._hb_times.items()):
                    if (now - last_hb) > self.heartbeat_timeout and rid not in self._records:
                        to_fault.append(rid)
            for rid in to_fault:
                self.report_fault(rid, FaultType.TIMEOUT, details='Heartbeat timeout')


_manager: Optional[FaultManager] = None


def get_fault_manager(**kwargs) -> FaultManager:
    global _manager
    if _manager is None:
        _manager = FaultManager(**kwargs)
    return _manager