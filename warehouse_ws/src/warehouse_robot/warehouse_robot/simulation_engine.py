"""
WAREX Simulation Engine
=======================
Drives task generation, scenarios, crash recovery, battery routing.
Imported by dashboard_server.py — runs in the same process.
"""

import threading
import time
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Callable

# ── Warehouse layout (matches WarehouseMap.jsx) ───────────────────────────────
SHELF_GOALS: List = [
    (4, 2),  (6, 2),  (8, 2),  (10, 2),
    (19, 2), (21, 2), (23, 2), (25, 2),
    (5, 9),  (8, 9),  (19, 9), (22, 9),
    (4, 11), (7, 11), (10, 11),
    (19, 11),(22, 11),(25, 11),
    (12, 5), (12, 10),(12, 16),
    (16, 5), (16, 10),(16, 16),
]

DROP_GOALS: List = [
    (27, 26),(28, 26),(27, 27),(28, 27),
]

DOCK_GOALS: List = [
    (1, 1),(2, 1),(1, 2),(2, 2),
    (1, 27),(2, 27),(1, 28),(2, 28),
]

BATTERY_REROUTE = 22.0
BATTERY_FULL    = 80.0


def _ckpt_name(robot_id: str) -> str:
    return f"{robot_id}_ckpt_{int(time.time())}.pkl"


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class RobotSim:
    robot_id:       str
    x:              float = 0.0
    y:              float = 0.0
    status:         str   = 'IDLE'
    battery:        float = 100.0
    task_id:        Optional[str] = None
    goal_x:         Optional[float] = None
    goal_y:         Optional[float] = None
    task_type:      str   = 'SHELF'
    last_hb:        float = field(default_factory=time.time)
    path_history:   List  = field(default_factory=list)
    sim_crashed:    bool  = False
    sim_crash_at:   Optional[float] = None
    tasks_done:     int   = 0
    crash_count:    int   = 0
    uptime_start:   float = field(default_factory=time.time)
    total_uptime:   float = 0.0
    total_downtime: float = 0.0

    def to_dict(self) -> dict:
        status = 'CRASHED' if self.sim_crashed else self.status
        return {
            'robot_id':     self.robot_id,
            'x':            round(self.x, 1),
            'y':            round(self.y, 1),
            'status':       status,
            'battery':      round(self.battery, 1),
            'task_id':      self.task_id,
            'goal_x':       self.goal_x,
            'goal_y':       self.goal_y,
            'last_updated': self.last_hb,
            'path_history': self.path_history[-20:],
        }


@dataclass
class TaskSim:
    task_id:    str
    robot_id:   str
    goal_x:     float
    goal_y:     float
    task_type:  str
    deadline:   float
    created_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {
            'task_id':     self.task_id,
            'robot_id':    self.robot_id,
            'goal_x':      self.goal_x,
            'goal_y':      self.goal_y,
            'deadline_in': max(0.0, self.deadline - time.time()),
            'age_s':       round(time.time() - self.created_at, 1),
            'status':      'ACTIVE',
        }


# ── Engine ────────────────────────────────────────────────────────────────────

class SimulationEngine:

    def __init__(self,
                 task_pub_fn: Callable,
                 log_pub_fn:  Callable = None):
        self._task_pub = task_pub_fn
        self._log_pub  = log_pub_fn
        self._lock     = threading.Lock()

        self.robots:   Dict[str, RobotSim]  = {}
        self.tasks:    Dict[str, TaskSim]   = {}
        self.events:   deque                = deque(maxlen=400)
        self.logs:     deque                = deque(maxlen=400)
        self.stats     = {'total': 0, 'met': 0, 'missed': 0, 'rate': 0.0}
        self._task_ctr = 0

        self.crash_mode   = 'none'
        self.scenario     = 'scale_6r'
        self.network_cond = 'GOOD'
        self._fail_prob   = 0.05

        self._scen_active = False
        self._scen_thread: Optional[threading.Thread] = None

        threading.Thread(target=self._monitor_loop, daemon=True).start()

    # ── ROS2 callbacks ────────────────────────────────────────────────────────

    def on_registration(self, robot_id: str, x: float, y: float):
        with self._lock:
            if robot_id in self.robots:
                return
            r = RobotSim(robot_id=robot_id, x=x, y=y)
            self.robots[robot_id] = r
            self._emit('ROBOT_REGISTERED', robot_id,
                       payload={'x': x, 'y': y})
            self._log(
                f'REGISTERED: {robot_id} at ({int(x)},{int(y)})',
                robot_id)
        self._assign_task(robot_id)

    def on_heartbeat(self, robot_id: str, x: float, y: float,
                     status: str, battery: float):
        with self._lock:
            r = self.robots.get(robot_id)
            if not r:
                return
            r.last_hb = time.time()
            r.x       = x
            r.y       = y
            r.path_history.append([x, y])
            if len(r.path_history) > 200:
                r.path_history = r.path_history[-200:]

            # Detect battery crossing the reroute threshold
            if (battery < BATTERY_REROUTE
                    and r.battery >= BATTERY_REROUTE
                    and not r.sim_crashed):
                self._emit('LOW_BATTERY', robot_id,
                           payload={'battery': battery})
                self._log(
                    f'LOW BATTERY: {robot_id} battery={battery:.0f}% '
                    f'— rerouting to charging dock', robot_id)

            r.battery = battery

            if not r.sim_crashed:
                r.status = status

            # Trigger dock reroute if needed
            if (battery < BATTERY_REROUTE
                    and not r.sim_crashed
                    and r.task_type != 'DOCK'
                    and r.status not in ('CHARGING', 'RECHARGING')):
                self._reroute_to_dock_locked(r)

            # Detect recharged after dock trip
            if (r.task_type == 'DOCK'
                    and battery >= BATTERY_FULL
                    and status in ('IDLE', 'CHARGING')):
                r.task_type = 'SHELF'
                self._log(
                    f'RECHARGED: {robot_id} battery={battery:.0f}% '
                    f'— returning to task queue', robot_id)

    def on_completion(self, robot_id: str, task_id: str, outcome: str):
        with self._lock:
            r = self.robots.get(robot_id)
            if not r:
                return
            t = self.tasks.pop(task_id, None)
            if t:
                met = time.time() <= t.deadline
                if met:
                    self.stats['met'] += 1
                else:
                    self.stats['missed'] += 1
                total = self.stats['met'] + self.stats['missed']
                self.stats['total'] = total
                self.stats['rate']  = round(
                    self.stats['met'] / max(1, total) * 100, 1)

            if outcome in ('COMPLETED', 'CRASHED'):
                if outcome == 'COMPLETED':
                    r.tasks_done += 1
                    self._emit('TASK_COMPLETED', robot_id, task_id,
                               payload={})
                    self._log(
                        f'COMPLETED: {task_id} by {robot_id} '
                        f'| battery={r.battery:.0f}%', robot_id)
                    # Advance cycle: SHELF -> DROP -> SHELF
                    if r.task_type == 'SHELF':
                        r.task_type = 'DROP'
                    elif r.task_type in ('DROP', 'DOCK'):
                        r.task_type = 'SHELF'
                r.task_id = None
                r.goal_x  = None
                r.goal_y  = None
                if not r.sim_crashed:
                    r.status = 'IDLE'

        # Assign next task outside lock
        with self._lock:
            r = self.robots.get(robot_id)
            should = r and not r.sim_crashed and r.task_id is None
        if should:
            self._assign_task(robot_id)

    # ── Task assignment ───────────────────────────────────────────────────────

    def _assign_task(self, robot_id: str):
        msg_str = None
        rx = ry = 0

        with self._lock:
            r = self.robots.get(robot_id)
            if not r or r.sim_crashed or r.task_id is not None:
                return
            if r.battery < 10.0:
                return

            # Choose goal based on cycle and battery
            if r.battery < BATTERY_REROUTE:
                task_type = 'DOCK'
                goal      = random.choice(DOCK_GOALS)
                r.status  = 'CHARGING'
            elif r.task_type == 'DOCK':
                task_type = 'DOCK'
                goal      = random.choice(DOCK_GOALS)
            elif r.task_type == 'DROP':
                task_type = 'DROP'
                goal      = random.choice(DROP_GOALS)
            else:
                task_type = 'SHELF'
                goal      = random.choice(SHELF_GOALS)

            self._task_ctr += 1
            task_id  = f'task_{self._task_ctr:04d}'
            dist     = abs(int(r.x) - goal[0]) + abs(int(r.y) - goal[1])
            deadline = time.time() + max(dist * 0.6 * 3.5, 6.0)

            t = TaskSim(
                task_id=task_id, robot_id=robot_id,
                goal_x=goal[0], goal_y=goal[1],
                task_type=task_type, deadline=deadline)
            self.tasks[task_id] = t
            r.task_id   = task_id
            r.goal_x    = float(goal[0])
            r.goal_y    = float(goal[1])
            r.task_type = task_type
            r.status    = 'CHARGING' if task_type == 'DOCK' else 'ACTIVE'
            rx, ry      = int(r.x), int(r.y)

            self._emit('TASK_ASSIGNED', robot_id, task_id,
                       payload={'goal_x': goal[0], 'goal_y': goal[1],
                                'task_type': task_type, 'dist': dist})
            self._log(
                f'ASSIGNED: {task_id} to {robot_id} '
                f'| goal=({goal[0]},{goal[1]}) type={task_type} '
                f'dist={dist} battery={r.battery:.0f}%', robot_id)

            msg_str = f'{task_id},{rx},{ry},{goal[0]},{goal[1]}'

            # Trigger random crash if mode enabled
            if (self.crash_mode == 'random'
                    and random.random() < self._fail_prob):
                threading.Thread(
                    target=self._delayed_crash,
                    args=(robot_id, random.uniform(2.0, 5.0)),
                    daemon=True).start()

        if msg_str:
            self._task_pub(robot_id, msg_str)

    def _reroute_to_dock_locked(self, r: RobotSim):
        """Must be called WITH self._lock held."""
        # Cancel active task
        if r.task_id and r.task_id in self.tasks:
            self.tasks.pop(r.task_id, None)
            self._emit('MISSED_DEADLINE', r.robot_id, r.task_id,
                       payload={})

        goal     = random.choice(DOCK_GOALS)
        self._task_ctr += 1
        task_id  = f'task_{self._task_ctr:04d}'
        deadline = time.time() + 60.0

        t = TaskSim(
            task_id=task_id, robot_id=r.robot_id,
            goal_x=goal[0], goal_y=goal[1],
            task_type='DOCK', deadline=deadline)
        self.tasks[task_id] = t
        r.task_id   = task_id
        r.goal_x    = float(goal[0])
        r.goal_y    = float(goal[1])
        r.task_type = 'DOCK'
        r.status    = 'CHARGING'

        self._emit('REROUTE', r.robot_id, task_id,
                   payload={'reason': 'low_battery',
                            'battery': r.battery,
                            'dock_x': goal[0], 'dock_y': goal[1]})
        self._log(
            f'BATTERY REROUTE: {r.robot_id} battery={r.battery:.0f}% '
            f'< {BATTERY_REROUTE}% -> DOCK ({goal[0]},{goal[1]})',
            r.robot_id)

        msg = f'{task_id},{int(r.x)},{int(r.y)},{goal[0]},{goal[1]}'
        self._task_pub(r.robot_id, msg)

    # ── Crash management ──────────────────────────────────────────────────────

    def inject_crash(self, robot_id: str):
        failed_task_id = None
        ckpt           = _ckpt_name(robot_id)

        with self._lock:
            r = self.robots.get(robot_id)
            if not r or r.sim_crashed:
                return
            failed_task_id     = r.task_id
            r.sim_crashed      = True
            r.sim_crash_at     = time.time()
            r.crash_count     += 1
            r.total_uptime    += time.time() - r.uptime_start
            r.status           = 'CRASHED'
            if failed_task_id:
                self.tasks.pop(failed_task_id, None)
            r.task_id = None
            r.goal_x  = None
            r.goal_y  = None

            self._emit('CRASH', robot_id, failed_task_id,
                       payload={'reason': 'fault_injected',
                                'checkpoint': ckpt})
            self._log(
                f'CRASH INJECTED: {robot_id} | sensor failure '
                f'| checkpoint saved -> {ckpt}', robot_id)

            if failed_task_id:
                # Find best available robot to reassign to
                best, best_bat = None, -1.0
                for rid, ro in self.robots.items():
                    if (rid != robot_id
                            and not ro.sim_crashed
                            and ro.task_id is None
                            and ro.battery > best_bat):
                        best_bat = ro.battery
                        best     = rid
                if best:
                    self._log(
                        f'REASSIGN: task -> {best} '
                        f'| cloud checkpoint {ckpt} restored '
                        f'| battery_margin={best_bat:.0f}%', best)

        # Schedule auto-recovery
        threading.Thread(
            target=self._recovery_timer,
            args=(robot_id,),
            daemon=True).start()

        # Reassign outside lock
        if failed_task_id and best:  # noqa: F821  (set in lock block above)
            self._assign_task(best)

    def drain_battery(self, robot_id: str):
        with self._lock:
            r = self.robots.get(robot_id)
            if not r:
                return
            r.battery = 12.0
            self._emit('LOW_BATTERY', robot_id,
                       payload={'battery': 12.0, 'forced': True})
            self._log(
                f'BATTERY DRAINED (demo): {robot_id} -> 12% '
                f'| triggering emergency dock routing', robot_id)
            if not r.sim_crashed and r.task_type != 'DOCK':
                self._reroute_to_dock_locked(r)

    def _delayed_crash(self, robot_id: str, delay: float):
        time.sleep(delay)
        self.inject_crash(robot_id)

    def _recovery_timer(self, robot_id: str, timeout: float = 8.0):
        time.sleep(timeout)
        with self._lock:
            r = self.robots.get(robot_id)
            if not r or not r.sim_crashed:
                return
            downtime         = time.time() - (r.sim_crash_at or time.time())
            r.total_downtime += downtime
            r.uptime_start   = time.time()
            r.sim_crashed    = False
            r.sim_crash_at   = None
            r.status         = 'IDLE'
            ckpt             = _ckpt_name(robot_id)
            self._emit('RECOVERY', robot_id,
                       payload={'downtime_s': round(downtime, 1),
                                'checkpoint': ckpt})
            self._log(
                f'RECOVERY: {robot_id} online '
                f'| restored from cloud checkpoint {ckpt} '
                f'| downtime={downtime:.1f}s', robot_id)
        self._assign_task(robot_id)

    # ── Scenarios ─────────────────────────────────────────────────────────────

    def get_scenarios(self) -> list:
        return [
            {
                'name':        'scale_6r',
                'num_robots':  6,
                'duration_s':  120,
                'network':     'GOOD',
                'description': '6 Robots - Continuous EDF Scheduling',
            },
            {
                'name':        'crash_recovery_demo',
                'num_robots':  6,
                'duration_s':  40,
                'network':     'GOOD',
                'description': 'Crash Injection + Cloud Checkpoint Restore',
            },
            {
                'name':        'battery_routing_demo',
                'num_robots':  6,
                'duration_s':  40,
                'network':     'GOOD',
                'description': 'Battery-Aware Rerouting to Charging Dock',
            },
        ]

    def run_scenario(self, name: str, duration: float = None):
        self.scenario = name
        # Stop any running scenario
        if self._scen_active:
            self._scen_active = False
            time.sleep(0.3)
        self._scen_active = True
        t = threading.Thread(
            target=self._scenario_worker,
            args=(name, duration),
            daemon=True)
        self._scen_thread = t
        t.start()
        self._log(f'SCENARIO STARTED: {name}', None)

    def _scenario_worker(self, name: str, duration: float = None):
        try:
            if name == 'scale_6r':
                self._scen_scale_6r()
            elif name == 'crash_recovery_demo':
                self._scen_crash_recovery()
            elif name == 'battery_routing_demo':
                self._scen_battery_routing()
        finally:
            self._scen_active = False

    def _scen_scale_6r(self):
        with self._lock:
            self.crash_mode = 'none'
        self._log(
            'SCALE_6R: normal EDF scheduling | crash_mode=none', None)
        for rid in list(self.robots.keys()):
            self._assign_task(rid)

    def _scen_crash_recovery(self):
        with self._lock:
            self.crash_mode = 'deterministic'
        self._log(
            'CRASH_RECOVERY_DEMO: starting robots, '
            'crash injection in 10s', None)
        for rid in list(self.robots.keys()):
            self._assign_task(rid)

        # Wait 10 seconds then crash first active robot
        for _ in range(100):
            if not self._scen_active:
                return
            time.sleep(0.1)

        with self._lock:
            targets = [rid for rid, r in self.robots.items()
                       if not r.sim_crashed and r.task_id]
        if targets:
            target = targets[0]
            self._log(
                f'SCENARIO: injecting fault on {target} now', target)
            self.inject_crash(target)

        for _ in range(120):
            if not self._scen_active:
                return
            time.sleep(0.1)

        self._log('CRASH_RECOVERY_DEMO: sequence complete', None)

    def _scen_battery_routing(self):
        with self._lock:
            self.crash_mode = 'none'
        self._log(
            'BATTERY_ROUTING_DEMO: starting robots, '
            'battery drain in 5s', None)
        for rid in list(self.robots.keys()):
            self._assign_task(rid)

        # Wait 5 seconds then drain first active robot
        for _ in range(50):
            if not self._scen_active:
                return
            time.sleep(0.1)

        with self._lock:
            targets = [rid for rid, r in self.robots.items()
                       if not r.sim_crashed and r.task_type != 'DOCK']
        if targets:
            target = targets[0]
            self._log(
                f'SCENARIO: draining battery on {target}', target)
            self.drain_battery(target)

        for _ in range(200):
            if not self._scen_active:
                return
            time.sleep(0.1)

        self._log('BATTERY_ROUTING_DEMO: sequence complete', None)

    def set_crash_mode(self, mode: str):
        with self._lock:
            self.crash_mode = mode
        self._log(f'CRASH MODE -> {mode}', None)

    def set_network(self, condition: str):
        with self._lock:
            self.network_cond = condition
        self._log(f'NETWORK -> {condition}', None)

    # ── Monitor (keeps idle robots assigned) ──────────────────────────────────

    def _monitor_loop(self):
        while True:
            time.sleep(2.5)
            now         = time.time()
            idle_robots = []
            with self._lock:
                for rid, r in self.robots.items():
                    if r.sim_crashed:
                        continue
                    if (now - r.last_hb) > 30.0:
                        continue
                    if r.task_id is None and r.status == 'IDLE':
                        idle_robots.append(rid)
            for rid in idle_robots:
                self._assign_task(rid)

    # ── Read API ──────────────────────────────────────────────────────────────

    def get_snapshot(self) -> dict:
        with self._lock:
            robots  = {rid: r.to_dict() for rid, r in self.robots.items()}
            tasks   = {tid: t.to_dict() for tid, t in self.tasks.items()}
            stats   = dict(self.stats)
            active  = sum(1 for r in self.robots.values()
                          if r.status == 'ACTIVE' and not r.sim_crashed)
            crashed = sum(1 for r in self.robots.values()
                          if r.sim_crashed)
            idle    = sum(1 for r in self.robots.values()
                          if r.status == 'IDLE' and not r.sim_crashed)
            nc = self.network_cond
            sc = self.scenario
            cm = self.crash_mode
        return {
            'timestamp':      time.time(),
            'robots':         robots,
            'tasks':          tasks,
            'stats':          stats,
            'active_robots':  active,
            'crashed_robots': crashed,
            'idle_robots':    idle,
            'scenario':       sc,
            'crash_mode':     cm,
            'network':        nc,
        }

    def get_events(self, n: int = 50) -> list:
        with self._lock:
            return list(reversed(list(self.events)[-n:]))

    def get_logs(self, n: int = 60) -> list:
        with self._lock:
            return list(self.logs)[-n:]

    def get_metrics(self) -> dict:
        with self._lock:
            rs = list(self.robots.values())
            s  = dict(self.stats)
        mttr_vals = [r.total_downtime / r.crash_count
                     for r in rs if r.crash_count > 0]
        mtbf_vals = [r.total_uptime / r.crash_count
                     for r in rs if r.crash_count > 0]
        fleet_mttr = (sum(mttr_vals) / len(mttr_vals)
                      if mttr_vals else 0.0)
        fleet_mtbf = (sum(mtbf_vals) / len(mtbf_vals)
                      if mtbf_vals else 99999)
        return {
            'fleet_mttr_s': round(fleet_mttr, 2),
            'fleet_mtbf_s': round(fleet_mtbf, 2),
            'system': {
                'total_tasks_generated': s.get('total', 0),
                'total_tasks_completed': s.get('met', 0),
                'total_tasks_failed':    s.get('missed', 0),
                'overall_deadline_rate': s.get('rate', 0.0),
                'throughput_per_minute': 0.0,
                'elapsed_s':             0.0,
            },
            'robots': {
                r.robot_id: {
                    'robot_id':         r.robot_id,
                    'tasks_completed':  r.tasks_done,
                    'crash_count':      r.crash_count,
                    'mttr_s':           round(
                        r.total_downtime / max(1, r.crash_count), 2),
                    'avg_battery_pct':  round(r.battery, 1),
                    'availability_pct': 100.0,
                    'deadlines_met':    s.get('met', 0),
                    'deadlines_missed': s.get('missed', 0),
                }
                for r in rs
            },
        }

    def get_faults(self) -> dict:
        with self._lock:
            active = {
                rid: {
                    'state':      'FAULTED',
                    'fault_type': 'CRASH',
                    'task_id':    None,
                    'retry_count': 0,
                    'duration_s': time.time() - (r.sim_crash_at or time.time()),
                }
                for rid, r in self.robots.items()
                if r.sim_crashed
            }
            recent  = [e for e in list(self.events)
                       if e.get('event_type') in ('CRASH', 'RECOVERY')][-20:]
            total_f = sum(r.crash_count for r in self.robots.values())
        return {
            'active': active,
            'recent': recent,
            'stats': {
                'total_faults':  total_f,
                'by_type':       {'CRASH': total_f},
                'active_faults': len(active),
            },
        }

    # ── Internals ─────────────────────────────────────────────────────────────

    def _emit(self, event_type: str, robot_id=None,
              task_id=None, payload=None):
        self.events.append({
            'event_type': event_type,
            'robot_id':   robot_id,
            'task_id':    task_id,
            'payload':    payload or {},
            'timestamp':  time.time(),
        })

    def _log(self, msg: str, robot_id=None):
        entry = {
            'ts':       round(time.time(), 3),
            'level':    ('WARN'
                         if any(w in msg for w in
                                ('CRASH', 'MISS', 'ERROR', 'FAULT',
                                 'DRAIN', 'REROUTE', 'LOW'))
                         else 'INFO'),
            'logger':   'simulation',
            'msg':      msg,
            'robot_id': robot_id,
        }
        self.logs.append(entry)
        if self._log_pub:
            try:
                self._log_pub(msg)
            except Exception:
                pass