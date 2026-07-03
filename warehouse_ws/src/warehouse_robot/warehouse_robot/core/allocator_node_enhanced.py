"""
Enhanced Allocator Node — BA-EDF + metrics + fault + twin integration.
"""
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import random
import time
import csv
import os
import logging

from warehouse_robot.scheduling.battery_aware_scheduler import (
    BatteryAwareScheduler, ChargingStation)
from warehouse_robot.metrics.metrics_backend import get_metrics
from warehouse_robot.fault.fault_manager import get_fault_manager, FaultType
from warehouse_robot.digital_twin.twin_feed import get_twin
from warehouse_robot.logging.structured_logger import configure_logging

log = logging.getLogger(__name__)

_CHARGING_STATIONS = [
    ChargingStation('charger_1', (5,  5)),
    ChargingStation('charger_2', (45, 5)),
    ChargingStation('charger_3', (25, 25)),
]


class EnhancedAllocatorNode(Node):

    def __init__(self):
        super().__init__('allocator_node_enhanced')
        configure_logging()

        self.robots:          dict  = {}
        self.task_counter:    int   = 0
        self.active_tasks:    dict  = {}
        self.task_targets:    dict  = {}
        self.task_deadlines:  dict  = {}
        self.task_created_at: dict  = {}
        self.task_publishers: dict  = {}
        self.task_robot_map:  dict  = {}
        self.total_tasks:     int   = 0
        self.deadlines_met:   int   = 0
        self.deadlines_missed: int  = 0
        self.step_interval:   float = 0.5
        self.deadline_slack:  float = 3.5
        self.experiment_start: float = time.time()

        self.scheduler = BatteryAwareScheduler(_CHARGING_STATIONS)
        self.metrics   = get_metrics()
        self.fault_mgr = get_fault_manager()
        self.twin      = get_twin()

        self.fault_mgr.on_fault    = self._handle_fault
        self.fault_mgr.on_recovery = self._handle_recovery

        self.csv_path = os.path.expanduser(
            '~/warehouse_ws/experiment_results/experiment_results.csv')
        os.makedirs(os.path.dirname(self.csv_path), exist_ok=True)
        self._init_csv()

        self.assignment_pub = self.create_publisher(String, 'task_assignment', 10)
        self.log_pub        = self.create_publisher(String, 'dashboard_log',   10)

        self.create_subscription(String, 'robot_registration', self.register_robot,    10)
        self.create_subscription(String, 'robot_heartbeat',    self.heartbeat_callback, 10)
        self.create_subscription(String, 'task_completion',    self.task_complete_cb,   10)

        self.create_timer(1.0,  self.monitor_robots)
        self.create_timer(5.0,  self.print_stats)
        self.create_timer(10.0, self._push_twin_stats)

        log.info('Enhanced Allocator started — BA-EDF + Metrics + FaultManager')

    def _init_csv(self):
        with open(self.csv_path, 'w', newline='') as f:
            csv.writer(f).writerow([
                'task_id', 'robot_id', 'goal_x', 'goal_y', 'manhattan_dist',
                'battery_at_assign', 'battery_at_complete', 'created_at',
                'completed_at', 'duration_s', 'deadline_s', 'deadline_met',
                'outcome', 'experiment_time_s',
            ])

    def _write_csv(self, task_id, robot_id, outcome, battery_complete, met):
        goal = self.task_targets.get(task_id)
        if not goal:
            return
        gx, gy       = goal
        created_at   = self.task_created_at.get(task_id, 0)
        deadline     = self.task_deadlines.get(task_id, 0)
        completed_at = time.time()
        duration     = round(completed_at - created_at, 3)
        deadline_s   = round(deadline - created_at, 3) if deadline else 0
        exp_time     = round(completed_at - self.experiment_start, 3)
        batt_assign  = self.task_robot_map.get(f'{task_id}_battery', 0)
        dist         = self.task_robot_map.get(f'{task_id}_dist', 0)
        with open(self.csv_path, 'a', newline='') as f:
            csv.writer(f).writerow([
                task_id, robot_id, gx, gy, dist,
                round(batt_assign, 1), round(battery_complete, 1),
                round(created_at, 3), round(completed_at, 3),
                duration, deadline_s, 1 if met else 0, outcome, exp_time,
            ])

    def register_robot(self, msg):
        robot_id, x, y = msg.data.split(',')
        self.robots[robot_id] = {
            'x': int(x), 'y': int(y), 'last_heartbeat': time.time(),
            'status': 'IDLE', 'current_task': None,
            'battery': 100.0, 'tasks_completed': 0, 'crash_handled': False,
        }
        self.scheduler.update_robot_state(robot_id, {
            'battery_level': 100.0, 'position': (int(x), int(y)), 'status': 'IDLE'})
        self.metrics.register_robot(robot_id)
        self.twin.register_robot(robot_id, float(x), float(y))
        log.info(f'{robot_id} registered at ({x},{y})')
        self.assign_task(robot_id)

    def _get_pub(self, robot_id):
        if robot_id not in self.task_publishers:
            self.task_publishers[robot_id] = self.create_publisher(
                String, f'/{robot_id}/task', 10)
        return self.task_publishers[robot_id]

    def manhattan(self, x1, y1, x2, y2):
        return abs(x2 - x1) + abs(y2 - y1)

    def battery_needed(self, robot_id, gx, gy):
        r = self.robots[robot_id]
        return self.manhattan(r['x'], r['y'], gx, gy) * 2.0 + 20.0

    def compute_deadline(self, robot_id, gx, gy):
        r    = self.robots[robot_id]
        dist = self.manhattan(r['x'], r['y'], gx, gy)
        return time.time() + max(dist * self.step_interval * self.deadline_slack, 5.0)

    def assign_task(self, robot_id):
        if robot_id not in self.robots:
            return
        r = self.robots[robot_id]
        if r['current_task'] or r['status'] != 'IDLE' or r['battery'] < 30.0:
            return

        self.task_counter += 1
        task_id = f'T{self.task_counter}'
        battery = r['battery']

        gx, gy, attempts = 0, 0, 0
        while attempts < 10:
            gx = random.randint(0, 29)
            gy = random.randint(0, 29)
            if battery >= self.battery_needed(robot_id, gx, gy):
                break
            attempts += 1

        deadline = self.compute_deadline(robot_id, gx, gy)
        dist     = self.manhattan(r['x'], r['y'], gx, gy)

        self.task_robot_map[task_id]              = robot_id
        self.task_robot_map[f'{task_id}_battery'] = battery
        self.task_robot_map[f'{task_id}_dist']    = dist
        self.active_tasks[task_id]                = robot_id
        self.task_targets[task_id]                = (gx, gy)
        self.task_deadlines[task_id]              = deadline
        self.task_created_at[task_id]             = time.time()
        r['current_task'] = task_id
        r['status']       = 'ACTIVE'
        self.total_tasks  += 1

        msg      = String()
        msg.data = f'{task_id},{r["x"]},{r["y"]},{gx},{gy}'
        self._get_pub(robot_id).publish(msg)

        dash      = String()
        dash.data = f'{task_id},{robot_id},{gx},{gy},{deadline - time.time():.1f}'
        self.assignment_pub.publish(dash)

        self.twin.update_task(task_id, robot_id, gx, gy, deadline - time.time())
        self.metrics.record_task_generated()

        log.info(f'[BA-EDF] {task_id} -> {robot_id} goal=({gx},{gy}) '
                 f'battery={battery:.1f}% deadline_in={deadline - time.time():.1f}s')

    def heartbeat_callback(self, msg):
        parts = msg.data.split(',')
        if len(parts) < 4:
            return
        robot_id = parts[0]
        if robot_id not in self.robots:
            return
        r = self.robots[robot_id]
        r['x']              = int(parts[1])
        r['y']              = int(parts[2])
        r['last_heartbeat'] = time.time()
        r['status']         = parts[3]
        if len(parts) > 4:
            r['battery'] = float(parts[4])

        self.fault_mgr.update_heartbeat(robot_id)
        self.scheduler.update_robot_state(robot_id, {
            'battery_level': r['battery'], 'position': (r['x'], r['y']),
            'status': r['status']})

        if parts[3] == 'CRASHED' and not r.get('crash_handled'):
            r['crash_handled'] = True
            ft = r['current_task']
            self.fault_mgr.report_fault(robot_id, FaultType.CRASH, task_id=ft)
            if ft:
                batt = r['battery']
                self._record_deadline(ft, met=False, reason='CRASH')
                self._write_csv(ft, robot_id, 'CRASHED', batt, False)
                r['current_task'] = None
                r['status']       = 'IDLE'
                self.reassign_task(ft, robot_id)

        if parts[3] in ('IDLE', 'CHARGING'):
            r['crash_handled'] = False

    def task_complete_cb(self, msg):
        parts    = msg.data.split(',')
        robot_id = parts[0]
        task_id  = parts[1]
        outcome  = parts[2] if len(parts) > 2 else 'COMPLETED'

        if task_id in self.active_tasks:
            del self.active_tasks[task_id]
        if robot_id in self.robots:
            r = self.robots[robot_id]
            r['tasks_completed'] += 1
            r['current_task']    = None
            r['status']          = 'IDLE'

        battery = self.robots.get(robot_id, {}).get('battery', 0)
        created = self.task_created_at.get(task_id, time.time())
        dur     = time.time() - created
        met     = self._record_deadline(task_id, met=None, reason=outcome)
        self._write_csv(task_id, robot_id, outcome, battery, met)

        if outcome == 'COMPLETED':
            self.metrics.record_task_completed(robot_id, dur, met)
            self.twin.task_completed(task_id, robot_id)
        elif outcome == 'CRASHED':
            self.twin.record_crash(robot_id, task_id)

        lm      = String()
        lm.data = (f'{robot_id} {"ON TIME" if met else "LATE"} '
                   f'{task_id} | battery={battery:.1f}%')
        self.log_pub.publish(lm)

        if outcome == 'COMPLETED':
            self.assign_task(robot_id)

    def _record_deadline(self, task_id, met, reason):
        if task_id not in self.task_deadlines:
            return True
        deadline = self.task_deadlines.pop(task_id, 0)
        self.task_created_at.pop(task_id, None)
        if met is None:
            met = (time.time() <= deadline)
        if met:
            self.deadlines_met    += 1
        else:
            self.deadlines_missed += 1
        return met

    def _handle_fault(self, robot_id, fault_type, task_id):
        log.error(f'[FAULT-CB] {robot_id} | {fault_type.value} | task={task_id}')

    def _handle_recovery(self, robot_id):
        log.info(f'[RECOVERY-CB] {robot_id} back online')
        self.assign_task(robot_id)

    def monitor_robots(self):
        now = time.time()
        for robot_id, r in list(self.robots.items()):
            age = now - r['last_heartbeat']
            if age > 8 and r['status'] == 'ACTIVE':
                self.get_logger().warning(f'{robot_id} TIMEOUT ({age:.1f}s)')
                ft = r['current_task']
                if ft:
                    self.fault_mgr.report_fault(robot_id, FaultType.TIMEOUT, task_id=ft)
                    self._record_deadline(ft, met=False, reason='TIMEOUT')
                    self._write_csv(ft, robot_id, 'TIMEOUT', r['battery'], False)
                    r['current_task'] = None
                    r['status']       = 'IDLE'
                    self.reassign_task(ft, robot_id)
            if r['status'] == 'IDLE' and not r['current_task'] and r['battery'] >= 30.0:
                self.assign_task(robot_id)

    def reassign_task(self, task_id, failed_robot):
        if task_id not in self.task_targets:
            return
        gx, gy = self.task_targets[task_id]
        best, best_batt = None, -1
        for rid, r in self.robots.items():
            if rid == failed_robot or r['status'] != 'IDLE' or r['battery'] < 30.0:
                continue
            if r['battery'] >= self.battery_needed(rid, gx, gy) and r['battery'] > best_batt:
                best_batt = r['battery']
                best      = rid
        if not best:
            log.warning(f'No robot to reassign {task_id}')
            self.task_targets.pop(task_id, None)
            return
        msg      = String()
        r        = self.robots[best]
        msg.data = f'{task_id},{r["x"]},{r["y"]},{gx},{gy}'
        self._get_pub(best).publish(msg)
        self.active_tasks[task_id] = best
        r['current_task'] = task_id
        r['status']       = 'ACTIVE'
        log.info(f'Reassigned {task_id} -> {best}')

    def print_stats(self):
        if not self.total_tasks:
            return
        rate = (self.deadlines_met / self.total_tasks) * 100.0
        self.get_logger().info(
            f'BA-EDF [{round(time.time()-self.experiment_start,1)}s] '
            f'total={self.total_tasks} met={self.deadlines_met} '
            f'missed={self.deadlines_missed} rate={rate:.1f}%')
        self.twin.update_stats(self.total_tasks, self.deadlines_met, self.deadlines_missed)
        lm      = String()
        lm.data = (f'[STATS] total={self.total_tasks} met={self.deadlines_met} '
                   f'missed={self.deadlines_missed} rate={rate:.1f}%')
        self.log_pub.publish(lm)

    def _push_twin_stats(self):
        self.twin.update_stats(self.total_tasks, self.deadlines_met, self.deadlines_missed)


def main(args=None):
    rclpy.init(args=args)
    node = EnhancedAllocatorNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()