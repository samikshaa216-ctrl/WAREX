#!/bin/bash
# Usage: ./scripts/run_system.sh [num_robots] [stop]
set -e

NUM_ROBOTS=${1:-6}
WS="$HOME/warehouse_ws"
LOG_DIR="$WS/logs"
PID_FILE="$WS/.pids"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}   $*"; }
err()     { echo -e "${RED}[ERR]${NC}  $*"; exit 1; }

if [ "$1" = "stop" ]; then
    info "Stopping warehouse system..."
    [ -f "$PID_FILE" ] && while IFS= read -r p; do kill "$p" 2>/dev/null || true; done < "$PID_FILE" && rm -f "$PID_FILE"
    pkill -f "ros2 launch warehouse_robot" 2>/dev/null || true
    pkill -f "ros2 run warehouse_robot api_gateway" 2>/dev/null || true
    ok "Stopped."; exit 0
fi

command -v ros2 &>/dev/null || err "ROS2 not sourced. Run: source /opt/ros/humble/setup.bash"
[ -f "$WS/install/setup.bash" ] || err "Workspace not built. Run colcon build first."

mkdir -p "$LOG_DIR" "$WS/checkpoints" "$WS/experiment_results"
rm -f "$PID_FILE"
source /opt/ros/humble/setup.bash
source "$WS/install/setup.bash"

echo -e "\n${GREEN}=== Warehouse Cloud Robotics | $NUM_ROBOTS robots ===${NC}\n"

# ROS2 system
info "Launching ROS2 nodes..."
ros2 launch warehouse_robot warehouse_system.launch.py num_robots:=$NUM_ROBOTS \
    > "$LOG_DIR/ros2.log" 2>&1 &
echo $! >> "$PID_FILE"
ok "ROS2 PID=$!"
sleep 5

# API gateway (embeds ROS2 bridge — single process)
info "Starting API gateway on :8080..."
ros2 run warehouse_robot api_gateway > "$LOG_DIR/api.log" 2>&1 &
echo $! >> "$PID_FILE"
ok "API gateway PID=$!"
sleep 3

# Health check
for i in {1..10}; do
    curl -sf http://localhost:8080/health > /dev/null 2>&1 && ok "API healthy." && break
    sleep 1
    [ $i -eq 10 ] && echo "WARNING: API not responding — check $LOG_DIR/api.log"
done

echo -e "\n${GREEN}=========================== READY ===========================${NC}"
echo -e "  Dashboard   → http://localhost:8000"
echo -e "  Swagger UI  → http://localhost:8080/docs"
echo -e "  Twin API    → http://localhost:8080/api/twin/snapshot"
echo -e "  WebSocket   → ws://localhost:8080/ws"
echo -e "  Fleet KPIs  → http://localhost:8080/api/status"
echo -e "${GREEN}==============================================================${NC}"
echo -e "\n  Stop:  ./scripts/run_system.sh stop\n"

tail -f "$LOG_DIR/ros2.log"