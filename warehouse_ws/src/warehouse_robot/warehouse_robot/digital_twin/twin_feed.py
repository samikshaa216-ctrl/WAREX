"""
Digital Twin Feed — thread-safe in-process fleet state mirror.
Write path: GatewayBridge (ROS2 callbacks in gateway process)
Read path:  FastAPI endpoints + WebSocket broadcast
"""
import time
import threading
import json
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any


@dataclass
class RobotTwinState:
    robot_id:     str
    x:            float = 0.0
    y:            float = 0.0
    status:       str   = 'IDLE'
    battery:      float = 100.0
    task_id:      Optional[str] = None
    goal_x:       Optional[float] = None
    goal_y:       Optional[float] = None
    last_updated: float = field(default_factory=time.time)
    path_history: List[List[float]] = field(default_factory=list)

    def update(self, **kwargs):
        for k, v in kwargs.items():
            if hasattr(self, k):
                setattr(self, k, v)
        self.last_updated = time.time()
        if 'x' in kwargs or 'y' in kwargs:
            self.path_history.append([self.x, self.y])
            if len(self.path_history) > 200:
                self.path_history = self.path_history[-200:]

    def to_dict(self):
        return {
            'robot_id':     self.robot_id,
            'x':            self.x,
            'y':            self.y,
            'status':       self.status,
            'battery':      round(self.battery, 1),
            'task_id':      self.task_id,
            'goal_x':       self.goal_x,
            'goal_y':       self.goal_y,
            'last_updated': self.last_updated,
            'path_history': self.path_history[-20:],
        }


@dataclass
class TaskTwinState:
    task_id:     str
    robot_id:    str
    goal_x:      float
    goal_y:      float
    deadline_in: float
    created_at:  float = field(default_factory=time.time)
    status:      str   = 'ACTIVE'

    def to_dict(self):
        return {
            'task_id':     self.task_id,
            'robot_id':    self.robot_id,
            'goal_x':      self.goal_x,
            'goal_y':      self.goal_y,
            'deadline_in': max(0.0, self.deadline_in),
            'age_s':       round(time.time() - self.created_at, 1),
            'status':      self.status,
        }


@dataclass
class TwinEvent:
    event_type: str
    robot_id:   Optional[str]
    task_id:    Optional[str]
    payload:    Dict[str, Any]
    timestamp:  float = field(default_factory=time.time)

    def to_dict(self):
        return {'event_type': self.event_type, 'robot_id': self.robot_id,
                'task_id': self.task_id, 'payload': self.payload,
                'timestamp': self.timestamp}


class DigitalTwinFeed:
    def __init__(self, max_events: int = 500):
        self._lock           = threading.Lock()
        self.robots:  Dict[str, RobotTwinState] = {}
        self.tasks:   Dict[str, TaskTwinState]  = {}
        self._events: deque = deque(maxlen=max_events)
        self.warehouse_graph: Dict[str, Any] = {}
        self.stats: Dict[str, Any] = {'total': 0, 'met': 0, 'missed': 0, 'rate': 0.0}

    def register_robot(self, robot_id: str, x: float = 0.0, y: float = 0.0):
        with self._lock:
            if robot_id not in self.robots:
                self.robots[robot_id] = RobotTwinState(robot_id=robot_id, x=x, y=y)
                self._emit('ROBOT_REGISTERED', robot_id=robot_id, payload={'x': x, 'y': y})

    def update_robot(self, robot_id: str, **kwargs):
        with self._lock:
            if robot_id not in self.robots:
                self.robots[robot_id] = RobotTwinState(robot_id=robot_id)
            self.robots[robot_id].update(**kwargs)
            self._emit('ROBOT_UPDATED', robot_id=robot_id, payload=kwargs)

    def update_task(self, task_id: str, robot_id: str,
                    goal_x: float, goal_y: float, deadline_in: float):
        with self._lock:
            self.tasks[task_id] = TaskTwinState(
                task_id=task_id, robot_id=robot_id,
                goal_x=goal_x, goal_y=goal_y, deadline_in=deadline_in)
            if robot_id in self.robots:
                self.robots[robot_id].update(task_id=task_id,
                                             goal_x=goal_x, goal_y=goal_y)
            self._emit('TASK_ASSIGNED', robot_id=robot_id, task_id=task_id,
                       payload={'goal_x': goal_x, 'goal_y': goal_y,
                                'deadline_in': deadline_in})

    def task_completed(self, task_id: str, robot_id: str):
        with self._lock:
            self.tasks.pop(task_id, None)
            if robot_id in self.robots:
                self.robots[robot_id].update(task_id=None, goal_x=None, goal_y=None)
            self._emit('TASK_COMPLETED', robot_id=robot_id, task_id=task_id, payload={})

    def record_crash(self, robot_id: str, task_id: Optional[str] = None):
        with self._lock:
            if robot_id in self.robots:
                self.robots[robot_id].update(status='CRASHED', task_id=None)
            self._emit('CRASH', robot_id=robot_id, task_id=task_id, payload={})

    def record_recovery(self, robot_id: str):
        with self._lock:
            if robot_id in self.robots:
                self.robots[robot_id].update(status='IDLE')
            self._emit('RECOVERY', robot_id=robot_id, payload={})

    def update_stats(self, total: int, met: int, missed: int):
        with self._lock:
            self.stats = {'total': total, 'met': met, 'missed': missed,
                          'rate': round((met / total * 100.0) if total > 0 else 0.0, 1)}

    def set_warehouse_graph(self, graph: Dict[str, Any]):
        with self._lock:
            self.warehouse_graph = graph

    def full_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                'timestamp':      time.time(),
                'robots':         {rid: r.to_dict() for rid, r in self.robots.items()},
                'tasks':          {tid: t.to_dict() for tid, t in self.tasks.items()},
                'stats':          dict(self.stats),
                'warehouse_graph': self.warehouse_graph,
                'active_robots':  sum(1 for r in self.robots.values() if r.status == 'ACTIVE'),
                'crashed_robots': sum(1 for r in self.robots.values() if r.status == 'CRASHED'),
                'idle_robots':    sum(1 for r in self.robots.values() if r.status == 'IDLE'),
            }

    def recent_events(self, n: int = 50) -> List[Dict[str, Any]]:
        with self._lock:
            events = list(self._events)[-n:]
        return [e.to_dict() for e in events]

    def robot_trail(self, robot_id: str) -> List[List[float]]:
        with self._lock:
            return list(self.robots[robot_id].path_history) if robot_id in self.robots else []

    def _emit(self, event_type, robot_id=None, task_id=None, payload=None):
        self._events.append(TwinEvent(event_type=event_type, robot_id=robot_id,
                                      task_id=task_id, payload=payload or {}))


_twin: Optional[DigitalTwinFeed] = None


def get_twin() -> DigitalTwinFeed:
    global _twin
    if _twin is None:
        _twin = DigitalTwinFeed()
    return _twin