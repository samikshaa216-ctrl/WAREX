"""
FastAPI Backend Gateway — FINAL CANONICAL VERSION
=================================================
KEY ARCHITECTURAL FIX: This gateway embeds a ROS2 GatewayBridge node
that runs in a background thread. Since twin_feed is an in-process
singleton, the bridge writes to it and the FastAPI endpoints read from it —
all in ONE process. This eliminates the process-isolation bug that caused
/api/twin/snapshot to always return empty robots.

Run:  ros2 run warehouse_robot api_gateway
URL:  http://localhost:8080/docs
WS:   ws://localhost:8080/ws
"""
import asyncio
import json
import logging
import threading
import time
from typing import Optional

import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import uvicorn
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from warehouse_interfaces.msg import RobotState as RobotStateMsg
from warehouse_robot.digital_twin.twin_feed import get_twin
from warehouse_robot.fault.fault_manager import get_fault_manager
from warehouse_robot.logging.structured_logger import configure_logging, query_logs
from warehouse_robot.metrics.metrics_backend import get_metrics
from warehouse_robot.network.network_simulator import (
    NetworkCondition, fleet_stats as net_fleet_stats, set_fleet_condition)

log = logging.getLogger(__name__)

# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title='Warehouse Cloud Robotics — API Gateway',
    version='2.0.0',
    description='REST + WebSocket backend for warehouse robot fleet. Swagger at /docs.',
    docs_url='/docs',
    redoc_url='/redoc',
)
app.add_middleware(CORSMiddleware, allow_origins=['*'],
                   allow_methods=['*'], allow_headers=['*'])

_ws_clients: set = set()


async def _broadcast_loop():
    """Push twin snapshot to all WebSocket clients at 10 Hz."""
    global _ws_clients
    while True:
        await asyncio.sleep(0.1)
        if not _ws_clients:
            continue
        payload = json.dumps(get_twin().full_snapshot(), default=str)
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
    log.info('Gateway started — WS broadcast at 10 Hz')


# ─── Liveness ─────────────────────────────────────────────────────────────────

@app.get('/health', tags=['System'])
async def health():
    return {'status': 'ok', 'ts': time.time(), 'version': '2.0.0'}


# ─── Fleet Status ─────────────────────────────────────────────────────────────

@app.get('/api/status', tags=['Fleet'])
async def fleet_status():
    twin    = get_twin()
    metrics = get_metrics()
    fm      = get_fault_manager()
    snap    = twin.full_snapshot()
    m_snap  = metrics.snapshot()
    return {
        'ts':             time.time(),
        'total_robots':   len(snap['robots']),
        'active_robots':  snap['active_robots'],
        'crashed_robots': snap['crashed_robots'],
        'idle_robots':    snap['idle_robots'],
        'active_tasks':   len(snap['tasks']),
        'stats':          snap['stats'],
        'fleet_mttr_s':   round(metrics.fleet_mttr(), 2),
        'fleet_mtbf_s':   round(metrics.fleet_mtbf(), 2) if metrics.fleet_mtbf() != float('inf') else 99999,
        'fault_summary':  fm.fault_summary(),
        'system_metrics': m_snap['system'],
    }


# ─── Robots ───────────────────────────────────────────────────────────────────

@app.get('/api/robots', tags=['Robots'])
async def get_robots():
    return {'robots': get_twin().full_snapshot()['robots']}


@app.get('/api/robots/{robot_id}', tags=['Robots'])
async def get_robot(robot_id: str):
    snap = get_twin().full_snapshot()
    r    = snap['robots'].get(robot_id)
    if r is None:
        raise HTTPException(404, f'Robot {robot_id!r} not found')
    m = get_metrics().snapshot()['robots'].get(robot_id, {})
    return {**r, 'metrics': m}


# ─── Tasks ────────────────────────────────────────────────────────────────────

@app.get('/api/tasks', tags=['Tasks'])
async def get_tasks():
    return {'tasks': get_twin().full_snapshot()['tasks']}


# ─── Metrics ─────────────────────────────────────────────────────────────────

@app.get('/api/metrics', tags=['Metrics'])
async def per_robot_metrics():
    return get_metrics().snapshot()


@app.get('/api/metrics/fleet', tags=['Metrics'])
async def fleet_metrics():
    m    = get_metrics()
    mtbf = m.fleet_mtbf()
    return {
        'fleet_mttr_s': round(m.fleet_mttr(), 2),
        'fleet_mtbf_s': round(mtbf, 2) if mtbf != float('inf') else 99999,
        'system':       m.snapshot()['system'],
    }


# ─── Faults ───────────────────────────────────────────────────────────────────

@app.get('/api/faults', tags=['Faults'])
async def get_faults():
    fm = get_fault_manager()
    return {'active': fm.fault_summary(), 'recent': fm.recent_faults(n=30),
            'stats': fm.fleet_stats()}


# ─── Network ─────────────────────────────────────────────────────────────────

@app.get('/api/network', tags=['Network'])
async def get_network():
    return net_fleet_stats()


@app.post('/api/network/condition', tags=['Network'])
async def set_network_condition(condition: str):
    try:
        cond = NetworkCondition[condition.upper()]
    except KeyError:
        raise HTTPException(400, f'Invalid condition. Valid: {[c.value for c in NetworkCondition]}')
    set_fleet_condition(cond)
    return {'applied': cond.value, 'ts': time.time()}


# ─── Logs ────────────────────────────────────────────────────────────────────

@app.get('/api/logs', tags=['Logs'])
async def get_logs(
    n:        int            = Query(100, ge=1, le=1000),
    level:    Optional[str]  = Query(None),
    robot_id: Optional[str]  = Query(None),
    event:    Optional[str]  = Query(None),
    since_ts: Optional[float] = Query(None),
):
    return {'logs': query_logs(n=n, level=level, robot_id=robot_id,
                               event=event, since_ts=since_ts)}


# ─── Digital Twin ─────────────────────────────────────────────────────────────

@app.get('/api/twin/snapshot', tags=['Twin'])
async def twin_snapshot():
    return get_twin().full_snapshot()


@app.get('/api/twin/events', tags=['Twin'])
async def twin_events(n: int = Query(50, ge=1, le=500)):
    return {'events': get_twin().recent_events(n=n)}


@app.get('/api/twin/trail/{robot_id}', tags=['Twin'])
async def robot_trail(robot_id: str):
    trail = get_twin().robot_trail(robot_id)
    if not trail:
        raise HTTPException(404, f'No trail for {robot_id!r}')
    return {'robot_id': robot_id, 'trail': trail}


# ─── Experiments ─────────────────────────────────────────────────────────────

@app.get('/api/experiment/scenarios', tags=['Experiments'])
async def list_scenarios():
    try:
        from warehouse_robot.experiments.experiment_runner import DEFAULT_SCENARIOS
        return {'scenarios': [
            {'name': s.name, 'num_robots': s.num_robots, 'duration_s': s.duration_s,
             'network': s.network_condition, 'description': s.description}
            for s in DEFAULT_SCENARIOS]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.post('/api/experiment/run', tags=['Experiments'])
async def run_experiment(scenario: str = Query(...), duration: Optional[float] = Query(None)):
    try:
        from warehouse_robot.experiments.experiment_runner import (
            DEFAULT_SCENARIOS, ExperimentRunner)
        matches = [s for s in DEFAULT_SCENARIOS if s.name == scenario]
        if not matches:
            raise HTTPException(404, f'Scenario {scenario!r} not found')
        sc = matches[0]
        if duration:
            sc.duration_s = duration
        runner = ExperimentRunner(api_base='http://localhost:8080')
        async def _bg():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, runner.run_scenario, sc)
        asyncio.create_task(_bg())
        return {'started': scenario, 'duration_s': sc.duration_s,
                'message': 'Running in background'}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── WebSocket ────────────────────────────────────────────────────────────────

@app.websocket('/ws')
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    log.info(f'WS connected | clients={len(_ws_clients)}')
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(ws)
        log.info(f'WS disconnected | clients={len(_ws_clients)}')


# ─── ROS2 Bridge Node (embeds in gateway process) ────────────────────────────

class GatewayBridge(Node):
    """
    Subscribes to all ROS2 topics and writes directly to the in-process
    twin_feed singleton. This is what makes /api/twin/snapshot work.
    """

    def __init__(self):
        super().__init__('gateway_bridge')
        twin = get_twin()

        self.create_subscription(RobotStateMsg, '/robot_state',
                                 lambda msg: twin.update_robot(
                                     msg.robot_id,
                                     x=float(msg.x), y=float(msg.y),
                                     status=msg.status,
                                     battery=float(msg.battery),
                                     task_id=msg.current_task or None,
                                 ), 10)

        self.create_subscription(String, 'robot_registration',
                                 self._on_registration, 10)

        self.create_subscription(String, 'task_assignment',
                                 self._on_assignment, 10)

        self.create_subscription(String, 'task_completion',
                                 self._on_completion, 10)

        self.create_subscription(String, 'warehouse_graph',
                                 self._on_graph, 10)

        self.create_subscription(String, 'dashboard_log',
                                 self._on_log, 10)

        self.get_logger().info('GatewayBridge started — subscribing to robot topics')

    def _on_registration(self, msg):
        parts = msg.data.split(',')
        if len(parts) >= 3:
            get_twin().register_robot(parts[0], float(parts[1]), float(parts[2]))
            get_metrics().register_robot(parts[0])

    def _on_assignment(self, msg):
        parts = msg.data.split(',')
        if len(parts) >= 4:
            try:
                get_twin().update_task(
                    parts[0], parts[1],
                    float(parts[2]), float(parts[3]),
                    float(parts[4]) if len(parts) > 4 else 30.0)
            except Exception:
                pass

    def _on_completion(self, msg):
        parts = msg.data.split(',')
        if len(parts) >= 2:
            robot_id, task_id = parts[0], parts[1]
            outcome = parts[2] if len(parts) > 2 else 'COMPLETED'
            if outcome == 'COMPLETED':
                get_twin().task_completed(task_id, robot_id)
            elif outcome == 'CRASHED':
                get_twin().record_crash(robot_id, task_id)

    def _on_graph(self, msg):
        import json
        try:
            graph = json.loads(msg.data)
            get_twin().set_warehouse_graph(graph)
        except Exception:
            pass

    def _on_log(self, msg):
        text = msg.data
        if '[STATS]' in text:
            try:
                parts = text.split()
                total, met, missed = 0, 0, 0
                for p in parts:
                    if p.startswith('total='):
                        total  = int(p.split('=')[1])
                    elif p.startswith('met='):
                        met    = int(p.split('=')[1])
                    elif p.startswith('missed='):
                        missed = int(p.split('=')[1])
                get_twin().update_stats(total, met, missed)
            except Exception:
                pass


def _ros_thread():
    """Run rclpy in a background thread so uvicorn can take the main thread."""
    rclpy.init()
    bridge = GatewayBridge()
    try:
        rclpy.spin(bridge)
    finally:
        bridge.destroy_node()
        rclpy.shutdown()


# ─── Entry point ─────────────────────────────────────────────────────────────

def main():
    configure_logging()

    # Start ROS2 bridge in background thread
    ros_t = threading.Thread(target=_ros_thread, daemon=True)
    ros_t.start()
    log.info('GatewayBridge ROS2 thread started')

    # Give bridge time to init before accepting requests
    time.sleep(1.0)

    # Run FastAPI on main thread
    uvicorn.run(app, host='0.0.0.0', port=8080,
                reload=False, log_level='info')


if __name__ == '__main__':
    main()
