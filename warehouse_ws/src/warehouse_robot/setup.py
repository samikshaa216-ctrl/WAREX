from setuptools import find_packages, setup

package_name = 'warehouse_robot'

setup(
    name=package_name,
    version='1.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch',
            ['launch/warehouse_system.launch.py', 'launch/gazebo_warex.launch.py']),
        ('share/warehouse_robot/worlds', ['worlds/warex_warehouse.world']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='samiksha',
    maintainer_email='samiksha@todo.todo',
    description='Warehouse Cloud Robotics — WAREX backend',
    license='Apache-2.0',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            # Core robot node (stable — DO NOT CHANGE)
            'robot_core        = warehouse_robot.robot_core:main',
            # Allocator kept for reference but NOT launched by default
            'allocator_node    = warehouse_robot.allocator_node:main',
            # Graph topology publisher
            'warehouse_graph   = warehouse_robot.warehouse_graph:main',
            # Combined FastAPI + simulation engine (replaces old dashboard)
            'dashboard_server  = warehouse_robot.dashboard_server:main',
            # Gazebo bridge for 3D visualization
            'gazebo_bridge     = warehouse_robot.gazebo_bridge:main',
        ],
    },
)
