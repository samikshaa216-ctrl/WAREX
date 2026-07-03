# WAREX — Warehouse Fleet Robotics Simulation

A ROS2-based warehouse robot fleet management system with real-time Gazebo 3D simulation and a live React monitoring dashboard.

## What This Project Does

WAREX simulates a fleet of 6 autonomous mobile robots (TurtleBot3 Waffle) operating inside a warehouse, coordinated by a battery-aware task allocation system. It demonstrates a full robotics software stack:

- **Backend (ROS2)**: Assigns pick/drop tasks to robots based on availability and battery level, tracks robot state (position, battery, task, status), simulates faults and network conditions, and exposes live data via a WebSocket/HTTP dashboard server.
- **3D Simulation (Gazebo Classic)**: Physically simulates 6 robots navigating a warehouse layout with shelves, walls, and charging docks, using LIDAR for obstacle awareness.
- **Bridge**: Syncs robot positions between the backend's grid-coordinate task system and Gazebo's real-world physics coordinates, converting task assignments into velocity commands that move the simulated robots.
- **Frontend (React dashboard)**: A live "fleet command center" UI showing each robot's status, position, battery, current task, task completion events, and fleet-wide metrics (success rate, MTTR, MTBF, throughput).

### Why It Exists

Built as a portfolio/learning project to demonstrate multi-system integration: ROS2 robotics middleware, physics simulation, real-time data pipelines, and full-stack dashboard development — the kind of stack used in real warehouse automation (e.g. Amazon Robotics, Ocado).

### Current Status

- ✅ Backend task allocation working (100% task success rate in testing)
- ✅ React dashboard fully functional, showing live robot positions/tasks/metrics
- ✅ All 6 robots spawn correctly in Gazebo
- 🚧 In progress: Gazebo bridge — getting simulated robots to physically move in sync with dashboard-reported positions (currently robots update on the dashboard but don't yet move in the 3D sim)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Robot middleware | ROS2 Humble |
| 3D Simulation | Gazebo Classic 11.10.2 |
| Simulated robots | TurtleBot3 Waffle (x6) |
| Backend logic | Python 3.10 |
| Frontend | React + Vite + TailwindCSS |
| Coordination | Custom ROS2 msg/srv interfaces |

---

## Project Structure
WAREX/
├── warehouse_ws/                  # ROS2 workspace (backend + simulation)
│   ├── src/
│   │   ├── warehouse_robot/       # Core package
│   │   │   ├── warehouse_robot/   # Python nodes: allocator, scheduler, gazebo_bridge,
│   │   │   │                      #   battery model, fault manager, dashboard server, etc.
│   │   │   ├── launch/            # gazebo_warex.launch.py, warehouse_system.launch.py
│   │   │   └── worlds/            # warex_warehouse.world (Gazebo world file)
│   │   └── warehouse_interfaces/  # Custom ROS2 message/service definitions
│   ├── config/                    # warehouse_params.yaml
│   ├── scripts/                   # run_system.sh, docker_entrypoint.sh
│   └── requirements.txt
└── warex/                         # React frontend
└── src/                       # App.jsx, WarehouseMap.jsx, api.js, etc.

---

## Getting This Project on a New / Blank Computer

These steps work on **any** blank Ubuntu machine (or WSL2 on Windows) — your own laptop after a reinstall, or a friend's laptop.

### Step 1: Set up Ubuntu (skip if already on Ubuntu/WSL)

**On Windows**, install WSL2 with Ubuntu first (in PowerShell as Administrator):
```powershell
wsl --install -d Ubuntu-22.04
```
Restart, then open the "Ubuntu" app from the Start Menu (not `cmd.exe`).

**On native Linux**, you're already set — just open a terminal.

### Step 2: Install core tools

```bash
sudo apt update
sudo apt install -y git curl python3-pip python3-venv
```

### Step 3: Install ROS2 Humble

Follow the official install guide (takes ~10 min):
https://docs.ros.org/en/humble/Installation/Ubuntu-Install-Debs.html

### Step 4: Install Gazebo Classic + TurtleBot3 packages

```bash
sudo apt install -y ros-humble-gazebo-ros-pkgs ros-humble-turtlebot3 ros-humble-turtlebot3-simulations
```

### Step 5: Install Node.js (for the dashboard)

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 6: Download the project from GitHub

Since this repo is **public**, no login is needed to download it — just clone it directly:

```bash
cd ~
git clone https://github.com/samikshaa216-ctrl/WAREX.git
cd WAREX
```

> If you want to make changes and push them back to GitHub later (not just view/run), you'll need to authenticate. Easiest way: set up an SSH key —
> ```bash
> ssh-keygen -t ed25519 -C "your-email@example.com" -f ~/.ssh/id_ed25519 -N ""
> cat ~/.ssh/id_ed25519.pub
> ```
> Copy the printed key and add it at https://github.com/settings/ssh/new (as an **SSH key**, not GPG), then switch the remote:
> ```bash
> git remote set-url origin git@github.com:samikshaa216-ctrl/WAREX.git
> ```

### Step 7: Set up the backend

```bash
cd ~/WAREX/warehouse_ws
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
source /opt/ros/humble/setup.bash
colcon build
source install/setup.bash
```

### Step 8: Set up the frontend

```bash
cd ~/WAREX/warex
npm install
```

---

## Running the Full System

You need **4 terminals** open simultaneously, all inside WSL/Ubuntu.

### Terminal 1 — Gazebo (3D simulation)

```bash
cd ~/WAREX/warehouse_ws
source /opt/ros/humble/setup.bash
source install/setup.bash
export TURTLEBOT3_MODEL=waffle
ros2 launch warehouse_robot gazebo_warex.launch.py
```
Wait ~60 seconds for all 6 robots to spawn.

### Terminal 2 — Backend (task allocation, scheduling, dashboard server)

```bash
cd ~/WAREX/warehouse_ws
source install/setup.bash
ros2 launch warehouse_robot warehouse_system.launch.py num_robots:=6
```

### Terminal 3 — Gazebo Bridge (syncs backend ↔ simulation)

```bash
cd ~/WAREX/warehouse_ws
source install/setup.bash
ros2 run warehouse_robot gazebo_bridge
```

### Terminal 4 — Frontend dashboard

```bash
cd ~/WAREX/warex
npm run dev
```
Open **http://localhost:3000** in your browser.

---

## Useful Debug Commands

```bash
# List all active ROS2 nodes
ros2 node list

# List topics for a specific robot
ros2 topic list | grep robot_001

# Watch a robot's live status from the backend
ros2 topic echo /robot_001/status

# Watch velocity commands being sent to Gazebo
ros2 topic echo /robot_001/cmd_vel
```

---

## Known Issues / Next Steps

- Gazebo bridge needs debugging so simulated robots visually move in sync with dashboard-reported task movement (currently dashboard updates correctly, Gazebo robots stay stationary).
- Timing dependency: bridge should ideally start *after* the backend is already publishing status messages.
- Backend/dashboard can already handle up to 15 robots, but Gazebo simulation is currently capped at 6 (spawn config only defines 6 robot positions in `gazebo_warex.launch.py`). Extending to 15 in Gazebo is a planned improvement.

---

## Author

Samiksha — built as a personal robotics/full-stack portfolio project.
