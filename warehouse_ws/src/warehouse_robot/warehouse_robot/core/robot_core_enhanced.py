"""
Enhanced Robot Core — fully corrected final version.
Fixes vs all previous versions:
  [1] task_completion published correctly — robots don't get stuck
  [2] _crash / _recover / _maybe_crash all implemented
  [3] battery depletion + charging state machine complete
  [4] RobotState.msg battery field populated
  [5] All state transitions complete
"""
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import random
import time

from warehouse_interfaces.msg import RobotState as RobotStateMsg
from warehouse_robot.battery.battery_model import BatteryModel, RobotState as BattState
from warehouse_robot.checkpoint.checkpoint_manager import CheckpointManager
from warehouse_robot.network.network_simulator import get_simulator
from warehouse_robot.digital_twin.twin_feed import get_twin
from warehouse_robot.metrics.metrics_backend import get_metrics
from warehouse_robot.fault.fault_manager import get_fault_manager, FaultType
from warehouse_robot.logging.structured_logger import RobotLogger, configure_logging


class EnhancedWarehouseRobot(Node):

    def __init__(self):
        super().__init__('warehouse_robot_enhanced')

        self.declare_parameter('robot_id',             'robot_001')
        self.declare_parameter('start_position_x',     0.0)
        self.declare_parameter('start_position_y',     0.0)
        self.declare_parameter('enable_battery_sim',   True)
        self.declare_parameter('enable_checkpointing', True)
        self.declare_parameter('crash_mode',           'none')
        self.declare_parameter('crash_percentage',     50.0)
        self.declare_parameter('failure_probability',  0.05)
        self.declare_parameter('recovery_timeout',     5.0)
        self.declare_parameter('step_interval',        0.5)

        self.robot_id      = self.get_parameter('robot_id').value
        self.x             = int(self.get_parameter('start_position_x').value)
        self.y             = int(self.get_parameter('start_position_y').value)
        self.enable_batt   = self.get_parameter('enable_battery_sim').value
        self.enable_ckpt   = self.get_parameter('enable_checkpointing').value
        self.crash_mode    = self.get_parameter('crash_mode').value
        self.crash_pct     = float(self.get_parameter('crash_percentage').value)
        self.fail_prob     = float(self.get_parameter('failure_probability').value)
        self.rec_timeout   = float(self.get_parameter('recovery_timeout').value)
        self.step_interval = float(self.get_parameter('step_interval').value)

        configure_logging()
        self.rlog      = RobotLogger(self.robot_id)
        self.battery   = BatteryModel({'critical_threshold': 20.0, 'low_threshold': 40.0})
        self.ckpt_mgr  = CheckpointManager(self.robot_id, {'compression': True})
        self.net_sim   = get_simulator(self.robot_id)
        self.twin      = get_twin()
        self.metrics   = get_metrics()
        self.fault_mgr = get_fault_manager()

        self.metrics.register_robot(self.robot_id)
        self.twin.register_robot(self.robot_id, float(self.x), float(self.y))
        self.fault_mgr.on_recovery = self._on_recovery_cb

        self.current_path:    list  = []
        self.current_step:    int   = 0
        self.task_id:         str   = None
        self.task_goal_x:     int   = 0
        self.task_goal_y:     int   = 0
        self.task_active:     bool  = False
        self.task_start_time: float = None
        self.crashed:         bool  = False
        self.battery_depleted: bool = False
        self.det_crash_done:  bool  = False
        self.recovery_timer         = None
        self.steps_since_ckpt: int  = 0

        self.reg_pub         = self.create_publisher(String,       'robot_registration', 10)
        self.hb_pub          = self.create_publisher(String,       'robot_heartbeat',    10)
        self.comp_pub        = self.create_publisher(String,       'task_completion',    10)
        self.robot_state_pub = self.create_publisher(RobotStateMsg, '/robot_state',      10)

        self.create_subscription(String, f'/{self.robot_id}/task',
                                 self.task_callback, 10)
        self.create_timer(self.step_interval, self.update_robot)

        self._register()
        self.rlog.info(f'Enhanced robot started at ({self.x},{self.y})',
                       event='ROBOT_START')

    def _register(self):
        msg      = String()
        msg.data = f'{self.robot_id},{self.x},{self.y}'
        self.reg_pub.publish(msg)

    def task_callback(self, msg):
        if self.battery.state.is_critical or self.crashed or self.battery_depleted:
            self.rlog.warning('Ignoring task — unavailable', event='TASK_REJECTED')
            return
        parts            = msg.data.split(',')
        self.task_id     = parts[0]
        self.task_goal_x = int(parts[3])
        self.task_goal_y = int(parts[4])
        self.current_path  = self._gen_path(self.x, self.y, self.task_goal_x, self.task_goal_y)
        self.current_step  = 0
        self.task_active   = True
        self.det_crash_done = False
        self.task_start_time = time.time()
        self.steps_since_ckpt = 0
        if self.enable_ckpt:
            self._save_checkpoint('TASK_START')
        self.metrics.record_task_generated()
        self.rlog.info(
            f'Task received -> ({self.task_goal_x},{self.task_goal_y}) '
            f'path_len={len(self.current_path)} battery={self.battery.state.level:.1f}%',
            task_id=self.task_id, event='TASK_START')

    def update_robot(self):
        # 1. Determine battery physics state
        if self.battery_depleted:
            batt_state = BattState.CHARGING
        elif self.crashed:
            batt_state = BattState.CRASHED
        elif self.task_active:
            batt_state = BattState.MOVING
        else:
            batt_state = BattState.IDLE

        batt = self.battery.update(self.step_interval, batt_state)
        self.metrics.record_battery(self.robot_id, batt.level)

        # 2. CRASHED
        if self.crashed:
            self._send_heartbeat('CRASHED', batt.level)
            self._publish_state('CRASHED', batt.level)
            return

        # 3. BATTERY DEPLETED — charging dock
        if self.battery_depleted:
            self._send_heartbeat('CHARGING', batt.level)
            self._publish_state('CHARGING', batt.level)
            if batt.level >= 80.0:
                self.battery_depleted = False
                self.rlog.info(f'Recharged to {batt.level:.1f}%', event='RECHARGE_COMPLETE')
            return

        # 4. Battery just hit 0
        if batt.level <= 0.0:
            self.battery_depleted = True
            self.task_active      = False
            if self.enable_ckpt:
                self._save_checkpoint('BATTERY_DEPLETED')
            self.rlog.error('Battery depleted — charging dock', event='BATTERY_DEAD',
                            task_id=self.task_id)
            self._send_heartbeat('CHARGING', 0.0)
            self._publish_state('CHARGING', 0.0)
            return

        # 5. IDLE
        if not self.task_active:
            self._send_heartbeat('IDLE', batt.level)
            self._publish_state('IDLE', batt.level)
            return

        # 6. TASK COMPLETE
        if self.current_step >= len(self.current_path):
            self._complete_task(batt.level)
            return

        # 7. MOVE ONE STEP
        self.x, self.y = self.current_path[self.current_step]
        self.current_step += 1

        self.twin.update_robot(self.robot_id, x=float(self.x), y=float(self.y),
                               status='ACTIVE', battery=batt.level, task_id=self.task_id)
        self._send_heartbeat('ACTIVE', batt.level)
        self._publish_state('ACTIVE', batt.level)

        if batt.level < 25.0:
            self.rlog.warning(f'LOW BATTERY {batt.level:.1f}%', event='LOW_BATTERY',
                              task_id=self.task_id)

        # 8. Adaptive checkpoint
        if self.enable_ckpt:
            self.steps_since_ckpt += 1
            interval = self._ckpt_interval(batt.level)
            if self.steps_since_ckpt >= interval:
                self._save_checkpoint('PERIODIC')

        # 9. Crash simulation
        self._maybe_crash()

    # ── Task completion — CRITICAL FIX: publishes to task_completion ──────────
    def _complete_task(self, batt_level: float):
        duration = time.time() - (self.task_start_time or time.time())
        if self.enable_ckpt:
            self._save_checkpoint('TASK_COMPLETE')

        # Publish so allocator knows and assigns next task
        msg      = String()
        msg.data = f'{self.robot_id},{self.task_id},COMPLETED'
        self.comp_pub.publish(msg)

        self.metrics.record_task_completed(self.robot_id, duration, deadline_met=True)
        self.twin.task_completed(self.task_id, self.robot_id)
        self.rlog.info(f'Task completed battery={batt_level:.1f}% dur={duration:.1f}s',
                       task_id=self.task_id, event='TASK_COMPLETE')
        self.task_active = False
        self.task_id     = None
        self._send_heartbeat('IDLE', batt_level)
        self._publish_state('IDLE', batt_level)

    # ── Crash simulation — all methods now implemented ─────────────────────────
    def _maybe_crash(self):
        if self.crash_mode == 'deterministic' and not self.det_crash_done:
            if len(self.current_path) > 0:
                progress = (self.current_step / len(self.current_path)) * 100.0
                if progress >= self.crash_pct:
                    self.det_crash_done = True
                    self._crash(f'Deterministic crash at {progress:.1f}%')
        elif self.crash_mode == 'random':
            if random.random() < self.fail_prob:
                self._crash('Random crash')

    def _crash(self, reason: str):
        if self.crashed:
            return
        self.crashed     = True
        self.task_active = False
        if self.enable_ckpt:
            self._save_checkpoint('PRE_CRASH')
        self.fault_mgr.report_fault(self.robot_id, FaultType.CRASH,
                                    task_id=self.task_id, details=reason)
        self.metrics.record_crash(self.robot_id)
        self.twin.record_crash(self.robot_id, self.task_id)
        self.rlog.error(reason, event='CRASH', task_id=self.task_id)
        self._publish_state('CRASHED', self.battery.state.level)
        if self.task_id:
            fail      = String()
            fail.data = f'{self.robot_id},{self.task_id},CRASHED'
            self.comp_pub.publish(fail)
            self.task_id = None
        if self.recovery_timer is None:
            self.recovery_timer = self.create_timer(self.rec_timeout, self._recover)

    def _recover(self):
        if not self.crashed:
            return
        self.crashed = False
        if self.recovery_timer:
            self.recovery_timer.cancel()
            self.recovery_timer = None
        self.fault_mgr.report_recovery(self.robot_id)
        self.metrics.record_recovery(self.robot_id)
        self.twin.record_recovery(self.robot_id)
        self.rlog.info('Recovered from crash', event='RECOVERY')
        self._send_heartbeat('IDLE', self.battery.state.level)
        self._publish_state('IDLE', self.battery.state.level)

    def _on_recovery_cb(self, robot_id: str):
        pass  # FaultManager global callback — no-op for self

    # ── Publishers ─────────────────────────────────────────────────────────────
    def _send_heartbeat(self, status: str, batt: float):
        msg      = String()
        msg.data = f'{self.robot_id},{self.x},{self.y},{status},{batt:.1f}'
        def do_pub():
            self.hb_pub.publish(msg)
        delivered, _ = self.net_sim.simulate_send(do_pub)
        if not delivered:
            self.rlog.debug('Heartbeat dropped by net sim', event='NET_DROP')
        self.fault_mgr.update_heartbeat(self.robot_id)
        self.twin.update_robot(self.robot_id, x=float(self.x), y=float(self.y),
                               status=status, battery=batt)

    def _publish_state(self, status: str, batt: float):
        msg              = RobotStateMsg()
        msg.robot_id     = self.robot_id
        msg.status       = status
        msg.current_task = self.task_id or ''
        msg.x            = float(self.x)
        msg.y            = float(self.y)
        msg.battery      = float(batt)   # FIX: populated
        self.robot_state_pub.publish(msg)

    # ── Helpers ────────────────────────────────────────────────────────────────
    def _ckpt_interval(self, batt: float) -> int:
        if batt < 20.0:
            return 1
        if batt < 40.0:
            return 5
        return 10

    def _save_checkpoint(self, trigger: str):
        state = {
            'robot_id': self.robot_id, 'x': self.x, 'y': self.y,
            'task_id': self.task_id, 'goal_x': self.task_goal_x, 'goal_y': self.task_goal_y,
            'current_step': self.current_step, 'path_len': len(self.current_path),
            'battery': self.battery.state.level, 'timestamp': time.time(), 'trigger': trigger,
        }
        try:
            cid, _ = self.ckpt_mgr.create_checkpoint(
                state, metadata={
                    'battery_level':   self.battery.state.level,
                    'network_quality': self.net_sim.quality_score(),
                    'task_id':         self.task_id,
                })
            self.steps_since_ckpt = 0
            self.rlog.debug(f'Checkpoint [{trigger}] id={cid}', event='CHECKPOINT')
        except Exception as e:
            self.rlog.warning(f'Checkpoint failed: {e}', event='CHECKPOINT_FAIL')

    def _gen_path(self, sx, sy, gx, gy):
        path, x, y = [], sx, sy
        while x != gx:
            x += 1 if gx > x else -1
            path.append((x, y))
        while y != gy:
            y += 1 if gy > y else -1
            path.append((x, y))
        return path


def main(args=None):
    rclpy.init(args=args)
    node = EnhancedWarehouseRobot()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()