"""
Battery-Aware EDF Scheduler
Combines Earliest-Deadline-First priority with battery feasibility checks.
"""
import heapq
import time
import math
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum


class TaskPriority(Enum):
    LOW      = 1
    NORMAL   = 3
    HIGH     = 4
    CRITICAL = 5


class TaskStatus(Enum):
    PENDING    = 'pending'
    ASSIGNED   = 'assigned'
    IN_PROGRESS = 'in_progress'
    COMPLETED  = 'completed'
    FAILED     = 'failed'
    TIMEOUT    = 'timeout'


@dataclass
class Task:
    task_id:            str
    task_type:          str
    deadline:           float
    estimated_duration: float
    priority:           TaskPriority
    location:           Tuple[float, float]
    payload_weight:     float = 0.0
    retry_count:        int   = 0
    status:             TaskStatus = TaskStatus.PENDING
    assigned_robot:     Optional[str] = None
    start_time:         Optional[float] = None
    completion_time:    Optional[float] = None

    def __lt__(self, other):
        if self.deadline == other.deadline:
            return self.priority.value > other.priority.value
        return self.deadline < other.deadline

    def time_until_deadline(self) -> float:
        return max(0.0, self.deadline - time.time())

    def is_overdue(self) -> bool:
        return time.time() > self.deadline


@dataclass
class RobotCandidate:
    robot_id:             str
    battery_level:        float
    position:             Tuple[float, float]
    status:               str
    estimated_travel_time: float
    estimated_task_energy: float
    battery_margin:        float
    total_score:           float

    def __lt__(self, other):
        return self.total_score > other.total_score


@dataclass
class ChargingStation:
    station_id: str
    position:   Tuple[float, float]
    occupied:   bool = False
    occupied_by: Optional[str] = None
    queue:      List[str] = field(default_factory=list)


class BatteryAwareScheduler:
    BATTERY_RESERVE = 15.0
    BATTERY_CRITICAL = 20.0
    BATTERY_LOW      = 40.0
    MAX_RETRIES      = 3
    ROBOT_SPEED      = 0.5  # m/s
    WEIGHT_BATTERY   = 0.35
    WEIGHT_DISTANCE  = 0.30
    WEIGHT_DEADLINE  = 0.25
    WEIGHT_UTIL      = 0.10

    def __init__(self, charging_stations: List[ChargingStation]):
        self.task_queue:       List[Task]              = []
        self.robot_states:     Dict[str, Dict[str, Any]] = {}
        self.charging_stations = {s.station_id: s for s in charging_stations}
        self.stats = {
            'tasks_assigned': 0, 'tasks_completed': 0,
            'tasks_failed': 0, 'tasks_timeout': 0,
            'deadline_misses': 0, 'charging_requests': 0,
            'total_assignment_time': 0.0,
        }

    def add_task(self, task: Task):
        heapq.heappush(self.task_queue, task)

    def update_robot_state(self, robot_id: str, state: Dict[str, Any]):
        self.robot_states[robot_id] = {**state, 'last_update': time.time()}

    def assign_task(self) -> Optional[Tuple[str, Task]]:
        if not self.task_queue:
            return None
        t0   = time.time()
        task = self.task_queue[0]
        if task.is_overdue():
            heapq.heappop(self.task_queue)
            task.status = TaskStatus.TIMEOUT
            self.stats['tasks_timeout']    += 1
            self.stats['deadline_misses']  += 1
            return None
        candidates = self._evaluate_candidates(task)
        if not candidates:
            return None
        best = max(candidates, key=lambda r: r.total_score)
        heapq.heappop(self.task_queue)
        task.status         = TaskStatus.ASSIGNED
        task.assigned_robot = best.robot_id
        task.start_time     = time.time()
        self.stats['tasks_assigned']        += 1
        self.stats['total_assignment_time'] += time.time() - t0
        return best.robot_id, task

    def _evaluate_candidates(self, task: Task) -> List[RobotCandidate]:
        candidates = []
        for rid, state in self.robot_states.items():
            if state.get('status') not in ('IDLE', 'AVAILABLE'):
                continue
            if state.get('is_charging') or state.get('crashed'):
                continue
            batt = state.get('battery_level', 0.0)
            if batt < self.BATTERY_CRITICAL:
                continue
            pos         = state.get('position', (0, 0))
            travel_time = self._travel_time(pos, task.location)
            total_time  = travel_time + task.estimated_duration
            energy      = self._energy(total_time, task.task_type,
                                       task.payload_weight,
                                       state.get('battery_health', 100.0))
            margin = batt - energy - self.BATTERY_RESERVE
            if margin < 0:
                continue
            score = self._score(batt, margin,
                                self._dist(pos, task.location),
                                task.time_until_deadline(),
                                state.get('utilization', 0.0))
            candidates.append(RobotCandidate(
                robot_id=rid, battery_level=batt, position=pos,
                status=state.get('status', ''), estimated_travel_time=travel_time,
                estimated_task_energy=energy, battery_margin=margin, total_score=score,
            ))
        return candidates

    def _score(self, batt, margin, dist, deadline_t, util):
        return (self.WEIGHT_BATTERY  * batt / 100.0 +
                self.WEIGHT_DISTANCE * max(0.0, 1.0 - dist / 50.0) +
                self.WEIGHT_DEADLINE * min(1.0, deadline_t / 300.0) +
                self.WEIGHT_UTIL     * (1.0 - util))

    def _travel_time(self, a, b):
        return self._dist(a, b) / self.ROBOT_SPEED

    def _dist(self, a, b):
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    def _energy(self, duration, task_type, weight, health):
        IDLE = 0.5; MOVE = 2.0; CARRY = 3.5; CAP = 50.0
        if task_type in ('PICKUP', 'DELIVER'):
            ah = (MOVE * duration * 0.7 + CARRY * duration * 0.5 +
                  IDLE * duration * 0.3) / 3600.0
        else:
            ah = MOVE * duration / 3600.0
        if weight > 0:
            ah *= 1.0 + (weight / 10.0) * 0.2
        ah *= 1.0 + (100.0 - health) / 100.0
        return (ah / CAP) * 100.0

    def should_charge(self, robot_id: str) -> bool:
        state = self.robot_states.get(robot_id, {})
        batt  = state.get('battery_level', 100.0)
        if batt < self.BATTERY_CRITICAL:
            return True
        if batt < self.BATTERY_LOW and self.task_queue:
            if self.task_queue[0].time_until_deadline() > 300.0:
                return True
        return False

    def assign_charging_station(self, robot_id: str,
                                position: Tuple[float, float]) -> Optional[str]:
        best, best_d = None, float('inf')
        for s in self.charging_stations.values():
            if not s.occupied:
                d = self._dist(position, s.position)
                if d < best_d:
                    best_d = d
                    best   = s
        if best:
            best.occupied    = True
            best.occupied_by = robot_id
            self.stats['charging_requests'] += 1
            return best.station_id
        nearest = min(self.charging_stations.values(),
                      key=lambda s: self._dist(position, s.position))
        nearest.queue.append(robot_id)
        return nearest.station_id

    def release_charging_station(self, robot_id: str, station_id: str):
        s = self.charging_stations.get(station_id)
        if not s or s.occupied_by != robot_id:
            return
        s.occupied    = False
        s.occupied_by = None
        if s.queue:
            nxt          = s.queue.pop(0)
            s.occupied    = True
            s.occupied_by = nxt

    def handle_robot_failure(self, robot_id: str):
        for task in self.task_queue:
            if task.assigned_robot == robot_id:
                task.retry_count += 1
                if task.retry_count >= self.MAX_RETRIES:
                    task.status = TaskStatus.FAILED
                    self.stats['tasks_failed'] += 1
                else:
                    task.status         = TaskStatus.PENDING
                    task.assigned_robot = None
                    task.start_time     = None
                    heapq.heapify(self.task_queue)

    def get_statistics(self) -> Dict[str, Any]:
        n   = max(1, self.stats['tasks_assigned'])
        avg = self.stats['total_assignment_time'] / n
        n2  = max(1, self.stats['tasks_completed'])
        mr  = (self.stats['deadline_misses'] / n2) * 100.0
        return {**self.stats,
                'avg_assignment_time_ms': avg * 1000.0,
                'deadline_miss_rate_pct': mr,
                'pending_tasks': sum(1 for t in self.task_queue
                                     if t.status == TaskStatus.PENDING)}