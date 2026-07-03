"""
WAREX Dashboard Server
======================
FastAPI + ROS2 + SimulationEngine — all in one process.
Runs on port 8080.
"""

import asyncio
import json
import logging
import os
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from warehouse_robot.simulation_engine import SimulationEngine

log = logging.getLogger(__name__)

# ── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(
    title='WAREX — Warehouse Fleet API',
    version='2.0.0',
    docs_url='/docs',
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

engine: Optional[SimulationEngine] = None
_ws_clients: set = set()


# ── WebSocket broadcast at 10 Hz ──────────────────────────────────────────────

async def _broadcast_loop():
    global _ws_clients
    while True:
        await asyncio.sleep(0.1)
        if not _ws_clients or engine is None:
            continue
        try:
            payload = json.dumps(engine.get_snapshot(), default=str)
        except Exception:
            continue
        dead = set()
        for ws in list(_ws_clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        _ws_clients -= dead


@app.on_event('startup')
async def _startup():
    asyncio.create_task(_broadcast_loop())


@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket):
    global _ws_clients
    await ws.accept()
    _ws_clients.add(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(ws)


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get('/health')
async def health():
    return {'status': 'ok', 'ts': time.time(), 'version': '2.0.0'}


@app.get('/api/status')
async def fleet_status():
    if engine is None:
        return {}
    snap = engine.get_snapshot()
    m = engine.get_metrics()
    fm = engine.get_faults()
    return {
        'ts': time.time(),
        'total_robots': len(snap['robots']),
        'active_robots': snap['active_robots'],
        'crashed_robots': snap['crashed_robots'],
        'idle_robots': snap['idle_robots'],
        'active_tasks': len(snap['tasks']),
        'stats': snap['stats'],
        'fleet_mttr_s': m['fleet_mttr_s'],
        'fleet_mtbf_s': m['fleet_mtbf_s'],
        'fault_summary': fm['active'],
        'system_metrics': m['system'],
        'scenario': snap['scenario'],
        'crash_mode': snap['crash_mode'],
    }


@app.get('/api/robots')
async def get_robots():
    if engine is None:
        return {'robots': {}}
    return {'robots': engine.get_snapshot()['robots']}


@app.get('/api/robots/{robot_id}')
async def get_robot(robot_id: str):
    if engine is None:
        return {}
    snap = engine.get_snapshot()
    r = snap['robots'].get(robot_id, {})
    m = engine.get_metrics()['robots'].get(robot_id, {})
    return {**r, 'metrics': m}


@app.post('/api/robots/{robot_id}/crash')
async def crash_robot(robot_id: str):
    if engine is None:
        return {'ok': False}
    engine.inject_crash(robot_id)
    return {'ok': True, 'robot_id': robot_id, 'action': 'crash_injected'}


@app.post('/api/robots/{robot_id}/battery/drain')
async def drain_battery(robot_id: str):
    if engine is None:
        return {'ok': False}
    engine.drain_battery(robot_id)
    return {'ok': True, 'robot_id': robot_id, 'action': 'battery_drained'}


@app.get('/api/tasks')
async def get_tasks():
    if engine is None:
        return {'tasks': {}}
    return {'tasks': engine.get_snapshot()['tasks']}


@app.get('/api/metrics')
async def get_metrics():
    if engine is None:
        return {}
    return engine.get_metrics()


@app.get('/api/metrics/fleet')
async def fleet_metrics():
    if engine is None:
        return {}
    return engine.get_metrics()


@app.get('/api/faults')
async def get_faults():
    if engine is None:
        return {}
    return engine.get_faults()


@app.get('/api/network')
async def get_network():
    if engine is None:
        return {}
    with engine._lock:
        cond = engine.network_cond
    return {'condition': cond, 'quality_score': 1.0, 'robots': {}}


@app.post('/api/network/condition')
async def set_network(condition: str):
    if engine:
        engine.set_network(condition)
    return {'applied': condition, 'ts': time.time()}


@app.get('/api/logs')
async def get_logs(n: int = 60):
    if engine is None:
        return {'logs': []}
    return {'logs': engine.get_logs(n)}


@app.get('/api/twin/snapshot')
async def twin_snapshot():
    if engine is None:
        return {}
    return engine.get_snapshot()


@app.get('/api/twin/events')
async def twin_events(n: int = 40):
    if engine is None:
        return {'events': []}
    return {'events': engine.get_events(n)}


@app.get('/api/twin/trail/{robot_id}')
async def robot_trail(robot_id: str):
    if engine is None:
        return {'trail': []}
    snap = engine.get_snapshot()
    r = snap['robots'].get(robot_id, {})
    return {'robot_id': robot_id, 'trail': r.get('path_history', [])}


@app.get('/api/experiment/scenarios')
async def list_scenarios():
    if engine is None:
        return {'scenarios': []}
    return {'scenarios': engine.get_scenarios()}


@app.post('/api/experiment/run')
async def run_experiment(scenario: str,
                         duration: Optional[float] = None):
    if engine is None:
        return {'ok': False}
    engine.run_scenario(scenario, duration)
    return {
        'started': scenario,
        'duration': duration,
        'message': f'Scenario "{scenario}" running',
    }


@app.post('/api/experiment/crash_mode')
async def set_crash_mode(mode: str):
    if engine:
        engine.set_crash_mode(mode)
    return {'mode': mode}


# ── ROS2 node ─────────────────────────────────────────────────────────────────

class DashboardNode(Node):

    def __init__(self, eng: SimulationEngine):
        super().__init__('dashboard_server')
        self._eng = eng
        self._task_pubs = {}

        # ✅ FIXED: subscribe to namespaced topics for all robots
        for i in range(1, 11):
            rid = f'robot_{i:03d}'

            self.create_subscription(
                String,
                f'/{rid}/robot_registration',
                self._on_reg,
                10
            )

            self.create_subscription(
                String,
                f'/{rid}/robot_heartbeat',
                self._on_hb,
                10
            )

            self.create_subscription(
                String,
                f'/{rid}/task_completion',
                self._on_complete,
                10
            )

        self._log_pub = self.create_publisher(
            String, 'dashboard_log', 10)

        self.get_logger().info(
            'WAREX Dashboard Node — '
            'FastAPI on http://0.0.0.0:8080')

    def _get_task_pub(self, robot_id: str):
        if robot_id not in self._task_pubs:
            self._task_pubs[robot_id] = self.create_publisher(
                String, f'/{robot_id}/task', 10)
        return self._task_pubs[robot_id]

    def publish_task(self, robot_id: str, msg_str: str):
        msg = String()
        msg.data = msg_str
        self._get_task_pub(robot_id).publish(msg)

    def publish_log(self, msg_str: str):
        msg = String()
        msg.data = msg_str
        self._log_pub.publish(msg)

    def _on_reg(self, msg: String):
        parts = msg.data.split(',')
        if len(parts) >= 3:
            try:
                self._eng.on_registration(
                    parts[0],
                    float(parts[1]),
                    float(parts[2]))
            except Exception as e:
                self.get_logger().error(f'reg: {e}')

    def _on_hb(self, msg: String):
        parts = msg.data.split(',')
        if len(parts) < 4:
            return
        try:
            battery = float(parts[4]) if len(parts) > 4 else 100.0
            self._eng.on_heartbeat(
                parts[0],
                float(parts[1]),
                float(parts[2]),
                parts[3],
                battery)
        except Exception as e:
            self.get_logger().error(f'hb: {e}')

    def _on_complete(self, msg: String):
        parts = msg.data.split(',')
        if len(parts) < 2:
            return
        try:
            outcome = parts[2] if len(parts) > 2 else 'COMPLETED'
            self._eng.on_completion(parts[0], parts[1], outcome)
        except Exception as e:
            self.get_logger().error(f'complete: {e}')


# ── Main ──────────────────────────────────────────────────────────────────────

def main(args=None):
    global engine

    _node_holder = [None]

    def task_pub_fn(robot_id: str, msg_str: str):
        node = _node_holder[0]
        if node:
            node.publish_task(robot_id, msg_str)

    def log_pub_fn(msg_str: str):
        node = _node_holder[0]
        if node:
            try:
                node.publish_log(msg_str)
            except Exception:
                pass

    engine = SimulationEngine(
        task_pub_fn=task_pub_fn,
        log_pub_fn=log_pub_fn,
    )

    def _ros_thread():
        rclpy.init(args=args)
        node = DashboardNode(engine)
        _node_holder[0] = node
        try:
            rclpy.spin(node)
        finally:
            node.destroy_node()
            rclpy.shutdown()

    ros_t = threading.Thread(target=_ros_thread, daemon=True)
    ros_t.start()
    time.sleep(1.5)

    os.makedirs(
        os.path.expanduser('~/warehouse_ws/logs'), exist_ok=True)
    os.makedirs(
        os.path.expanduser('~/warehouse_ws/checkpoints'), exist_ok=True)

    print('[WAREX] FastAPI starting on http://0.0.0.0:8080')
    print('[WAREX] Docs: http://localhost:8080/docs')

    uvicorn.run(
        app,
        host='0.0.0.0',
        port=8080,
        log_level='warning',
        access_log=False,
    )


if __name__ == '__main__':
    main()