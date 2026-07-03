import os
from launch import LaunchDescription
from launch.actions import IncludeLaunchDescription, TimerAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import Node
from ament_index_python.packages import get_package_share_directory

# Backend uses grid coordinates, we need to spawn at matching world positions
# Backend grid: (11,6), (15,6), (19,6), (11,20), (15,20), (19,20)
# These should align with the warehouse layout

# Robot spawn positions - matching backend starting positions
# Format: (backend_grid_x, backend_grid_y, gazebo_world_x, gazebo_world_y)
ROBOT_POSITIONS = [
    # Bottom row
    ('robot_001', 11, 6, 5.5, 3.0),   # Backend (11,6) -> Gazebo world position
    ('robot_002', 15, 6, 7.5, 3.0),
    ('robot_003', 19, 6, 9.5, 3.0),
    # Top row  
    ('robot_004', 11, 20, 5.5, 10.0),
    ('robot_005', 15, 20, 7.5, 10.0),
    ('robot_006', 19, 20, 9.5, 10.0),
]


def make_robot(name, backend_x, backend_y, world_x, world_y, yaw=0.0):
    return Node(
        package='gazebo_ros',
        executable='spawn_entity.py',
        arguments=[
            '-entity', name,
            '-file', os.path.join(
                get_package_share_directory('turtlebot3_gazebo'),
                'models', 'turtlebot3_waffle',
                'model.sdf'
            ),
            '-x', str(world_x),
            '-y', str(world_y),
            '-z', '0.01',
            '-Y', str(yaw),
            '-robot_namespace', name,
        ],
        output='screen'
    )


def generate_launch_description():
    pkg = get_package_share_directory('warehouse_robot')
    world_file = os.path.join(pkg, 'worlds', 'warex_warehouse.world')
    
    gazebo_pkg = get_package_share_directory('gazebo_ros')

    ld = LaunchDescription()

    # Launch Gazebo with the world file
    ld.add_action(
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(gazebo_pkg, 'launch', 'gzserver.launch.py')
            ),
            launch_arguments={'world': world_file, 'verbose': 'true'}.items()
        )
    )

    ld.add_action(
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource(
                os.path.join(gazebo_pkg, 'launch', 'gzclient.launch.py')
            )
        )
    )

    # Spawn robots with delays
    for i, (name, bg_x, bg_y, world_x, world_y) in enumerate(ROBOT_POSITIONS):
        ld.add_action(
            TimerAction(
                period=float(5 + i * 3),
                actions=[make_robot(name, bg_x, bg_y, world_x, world_y)]
            )
        )

    return ld
