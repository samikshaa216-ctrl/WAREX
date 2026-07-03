"""
Backend unit tests — no ROS2 needed.
Run: cd ~/warehouse_ws && python3 -m pytest src/warehouse_robot/test/test_backend.py -v
"""
import time
import pytest


class TestBatteryModel:
    def _make(self):
        from warehouse_robot.battery.battery_model import BatteryModel, RobotState
        return BatteryModel(), RobotState

    def test_initial_level(self):
        bm, _ = self._make()
        assert bm.state.level == 100.0

    def test_discharge_reduces_level(self):
        bm, RS = self._make()
        for _ in range(20):
            bm.update(0.5, RS.MOVING)
        assert bm.state.level < 100.0

    def test_charging_increases_level(self):
        bm, RS = self._make()
        for _ in range(40):
            bm.update(0.5, RS.MOVING)
        lvl = bm.state.level
        for _ in range(20):
            bm.update(1.0, RS.CHARGING)
        assert bm.state.level > lvl

    def test_critical_flag(self):
        bm, RS = self._make()
        bm.state.level = 15.0
        bm.update(0.1, RS.IDLE)
        assert bm.state.is_critical is True


class TestCheckpointManager:
    def _make(self):
        from warehouse_robot.checkpoint.checkpoint_manager import CheckpointManager
        return CheckpointManager('robot_test', {'compression': True})

    def test_roundtrip(self):
        cm    = self._make()
        state = {'x': 5, 'y': 10, 'battery': 75.0}
        cid, _ = cm.create_checkpoint(state)
        result = cm.restore_checkpoint(cid)
        assert result == state

    def test_integrity(self):
        cm    = self._make()
        state = {'data': [1, 2, 3]}
        cid, _ = cm.create_checkpoint(state)
        assert cm.restore_checkpoint(cid, verify=True) == state

    def test_lru_eviction(self):
        cm = self._make()
        for i in range(15):
            cm.create_checkpoint({'i': i})
        assert len(cm.local_checkpoints) <= 10


class TestDigitalTwinFeed:
    def _make(self):
        from warehouse_robot.digital_twin.twin_feed import DigitalTwinFeed
        return DigitalTwinFeed()

    def test_register_and_read(self):
        twin = self._make()
        twin.register_robot('r1', 3.0, 4.0)
        snap = twin.full_snapshot()
        assert 'r1' in snap['robots']
        assert snap['robots']['r1']['x'] == 3.0

    def test_update_robot(self):
        twin = self._make()
        twin.register_robot('r1')
        twin.update_robot('r1', status='ACTIVE', battery=72.5)
        snap = twin.full_snapshot()
        assert snap['robots']['r1']['status'] == 'ACTIVE'
        assert snap['robots']['r1']['battery'] == 72.5

    def test_task_lifecycle(self):
        twin = self._make()
        twin.register_robot('r1')
        twin.update_task('T1', 'r1', 10.0, 15.0, 30.0)
        assert 'T1' in twin.full_snapshot()['tasks']
        twin.task_completed('T1', 'r1')
        assert 'T1' not in twin.full_snapshot()['tasks']

    def test_crash_recovery(self):
        twin = self._make()
        twin.register_robot('r1')
        twin.record_crash('r1')
        assert twin.full_snapshot()['robots']['r1']['status'] == 'CRASHED'
        twin.record_recovery('r1')
        assert twin.full_snapshot()['robots']['r1']['status'] == 'IDLE'

    def test_counts(self):
        twin = self._make()
        twin.register_robot('r1')
        twin.register_robot('r2')
        twin.update_robot('r1', status='ACTIVE')
        twin.record_crash('r2')
        snap = twin.full_snapshot()
        assert snap['active_robots']  == 1
        assert snap['crashed_robots'] == 1


class TestMetricsBackend:
    def _make(self):
        from warehouse_robot.metrics.metrics_backend import MetricsBackend
        return MetricsBackend()

    def test_register(self):
        m = self._make()
        m.register_robot('r1')
        assert 'r1' in m.robots

    def test_task_met(self):
        m = self._make()
        m.register_robot('r1')
        m.record_task_completed('r1', 10.0, True)
        snap = m.snapshot()
        assert snap['robots']['r1']['deadlines_met'] == 1

    def test_crash_and_recovery_mttr(self):
        m = self._make()
        m.register_robot('r1')
        m.record_crash('r1')
        time.sleep(0.05)
        m.record_recovery('r1')
        snap = m.snapshot()
        assert snap['robots']['r1']['crash_count'] == 1
        assert snap['robots']['r1']['mttr_s'] > 0


class TestFaultManager:
    def _make(self):
        from warehouse_robot.fault.fault_manager import FaultManager
        return FaultManager(max_retries=3, recovery_timeout=0.5, heartbeat_timeout=0.3)

    def test_fault_and_recovery(self):
        from warehouse_robot.fault.fault_manager import FaultType
        fm       = self._make()
        received = []
        fm.on_recovery = lambda rid: received.append(rid)
        fm.report_fault('r1', FaultType.CRASH, task_id='T1')
        fm.report_recovery('r1')
        assert 'r1' in received

    def test_healthy_after_recovery(self):
        from warehouse_robot.fault.fault_manager import FaultType, RecoveryState
        fm = self._make()
        fm.report_fault('r1', FaultType.CRASH)
        fm.report_recovery('r1')
        assert fm.is_healthy('r1')

    def test_fleet_stats(self):
        from warehouse_robot.fault.fault_manager import FaultType
        fm = self._make()
        fm.report_fault('r1', FaultType.CRASH)
        fm.report_fault('r2', FaultType.TIMEOUT)
        stats = fm.fleet_stats()
        assert stats['total_faults'] == 2


class TestNetworkSimulator:
    def test_good_low_drop(self):
        from warehouse_robot.network.network_simulator import NetworkSimulator, NetworkCondition
        sim = NetworkSimulator()
        sim.set_condition(NetworkCondition.GOOD)
        delivered = sum(1 for _ in range(100) if sim.simulate_send(lambda: None)[0])
        assert delivered >= 95

    def test_offline_all_drop(self):
        from warehouse_robot.network.network_simulator import NetworkSimulator, NetworkCondition
        sim = NetworkSimulator()
        sim.set_condition(NetworkCondition.OFFLINE)
        results = [sim.simulate_send(lambda: None)[0] for _ in range(10)]
        assert all(r is False for r in results)

    def test_stats_tracked(self):
        from warehouse_robot.network.network_simulator import NetworkSimulator
        sim = NetworkSimulator()
        for _ in range(20):
            sim.simulate_send(lambda: None)
        assert sim.get_stats()['packets_sent'] == 20