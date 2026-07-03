# WAREX — Warehouse Fleet Robotics Simulation

A ROS2-based warehouse robot fleet management system with Gazebo 3D simulation and a real-time React dashboard.

## Overview

WAREX simulates a fleet of 6 TurtleBot3 robots operating in a warehouse, coordinated by an autonomous task allocator. Robot state, task assignment, and battery levels are tracked live and mirrored between:
- A ROS2 backend (task scheduling, battery modeling, fault management)
- A Gazebo 3D physics simulation (robot movement, sensors, collision)
- A React web dashboard (fleet monitoring, task events, live metrics)

## Project Structure
WAREX/
├── warehouse_ws/          # ROS2 Humble workspace (backend)
│   ├── src/
│   │   ├── warehouse_robot/       # Core nodes: allocator, scheduler, gazebo bridge, dashboard server
│   │   └── warehouse_interfaces/  # Custom ROS2 msg/srv definitions
│   ├── config/             # Warehouse parameters
│   ├── scripts/            # Run/entrypoint scripts
│   └── requirements.txt
└── warex/                  # React + Vite frontend dashboard
└── src/

## Tech Stack

- **Backend**: ROS2 Humble, Python, Gazebo Classic 11
- **Simulation**: TurtleBot3 Waffle models, custom warehouse world
- **Frontend**: React, Vite, TailwindCSS
- **Robots**: 6-robot fleet, autonomous task allocation, battery-aware scheduling

## Running the System

Requires 4 terminals (ROS2 Humble + Gazebo Classic + Node.js installed):

**Terminal 1 — Gazebo:**
```bash
cd warehouse_ws
source /opt/ros/humble/setup.bash
source install/setup.bash
export TURTLEBOT3_MODEL=waffle
ros2 launch warehouse_robot gazebo_warex.launch.py
```

**Terminal 2 — Backend:**
```bash
cd warehouse_ws
source install/setup.bash
ros2 launch warehouse_robot warehouse_system.launch.py num_robots:=6
```

**Terminal 3 — Gazebo Bridge:**
```bash
cd warehouse_ws
source install/setup.bash
ros2 run warehouse_robot gazebo_bridge
```

**Terminal 4 — Frontend:**
```bash
cd warex
npm install
npm run dev
```
Dashboard: http://localhost:3000

## Status

Actively in development. Backend task allocation and dashboard are functional; Gazebo bridge (backend ↔ simulation sync) is being debugged for real-time robot movement.

## Author

Samiksha
