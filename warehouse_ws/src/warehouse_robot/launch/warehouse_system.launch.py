"""
WAREX Warehouse System Launch File
===================================
Nodes launched:
  1. warehouse_graph   — static topology publisher
  2. dashboard_server  — FastAPI :8080 + SimulationEngine (replaces allocator)
  3. N × robot_core    — one per robot

REMOVED: allocator_node — the dashboard_server's SimulationEngine handles
         all task assignment now (avoids double-assignment conflicts).

FIXED:   start_x / start_y (not start_position_x/y) — robots now spawn
         at correct spread positions within the 30×30 grid.
"""

from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction, LogInfo
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


# ── Good robot starting positions within the 30×30 visible grid ──────────────
# These avoid major shelf clusters (shelves at x=3-10,18-25 / y=3,5,7,13,15)
# Robots start in the central aisle and lower section.
_START_POSITIONS = [
    (11,  6), (15,  6), (19,  6),   # row 0 — central aisle, upper
    (11, 20), (15, 20), (19, 20),   # row 1 — lower section
    ( 3, 14), (27, 14),              # row 2 — left/right edges
    ( 8, 25), (20, 25),              # row 3 — bottom area
]


def _spawn_robots(context, *args, **kwargs):
    num_robots = int(LaunchConfiguration('num_robots').perform(context))
    if not 1 <= num_robots <= 10:
        raise ValueError(f'num_robots must be 1-10, got {num_robots}')

    nodes = []
    for i in range(num_robots):
        robot_id = f'robot_{i + 1:03d}'
        sx, sy   = _START_POSITIONS[i % len(_START_POSITIONS)]

        nodes.append(Node(
            package='warehouse_robot',
            executable='robot_core',
            name=robot_id,
            namespace=robot_id,
            output='screen',
            parameters=[{
                'robot_id':   robot_id,
                # FIXED: robot_core.py declares 'start_x' / 'start_y'
                'start_x':    float(sx),
                'start_y':    float(sy),
                # Battery settings — tuned for continuous visible movement
                'battery_level':              100.0,
                'battery_drain_per_step':       1.2,  # slower drain = more movement
                'battery_critical_threshold':  20.0,
                'battery_recharge_rate':        2.0,  # faster recharge
                # Step timing
                'step_interval': 0.5,
                # Crash mode — overridden at runtime by simulation engine
                'crash_mode':         'none',
                'crash_percentage':    50.0,
                'failure_probability':  0.04,
                'recovery_timeout':     6.0,
            }],
        ))
        nodes.append(LogInfo(
            msg=f'Spawning {robot_id} at ({sx},{sy})'))

    return nodes


def generate_launch_description():
    return LaunchDescription([
        DeclareLaunchArgument(
            'num_robots',
            default_value='6',
            description='Number of robots to spawn (1-10)',
        ),

        LogInfo(msg='=== WAREX Warehouse System Starting ==='),
        LogInfo(msg=['Robots: ', LaunchConfiguration('num_robots')]),

        # Static warehouse topology publisher
        Node(
            package='warehouse_robot',
            executable='warehouse_graph',
            name='warehouse_graph',
            output='screen',
        ),

        # Combined FastAPI gateway + SimulationEngine (task assigner + API server)
        # Runs on port 8080 — proxied by Vite dev server at :3000
        Node(
            package='warehouse_robot',
            executable='dashboard_server',
            name='dashboard_server',
            output='screen',
        ),

        # Dynamic robot nodes
        OpaqueFunction(function=_spawn_robots),

        LogInfo(msg='=== All WAREX nodes launched — API at http://localhost:8080/docs ==='),
    ])