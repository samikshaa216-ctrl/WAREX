FROM ros:humble-ros-base-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3-pip \
    python3-colcon-common-extensions \
    python3-rosdep \
    ros-humble-launch \
    ros-humble-launch-ros \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir --break-system-packages -r /tmp/requirements.txt

WORKDIR /warehouse_ws
COPY src/ src/

SHELL ["/bin/bash", "-c"]

RUN source /opt/ros/humble/setup.bash && \
    colcon build --packages-select warehouse_interfaces \
      --cmake-args -DCMAKE_BUILD_TYPE=Release && \
    source install/setup.bash && \
    colcon build --packages-select warehouse_robot \
      --cmake-args -DCMAKE_BUILD_TYPE=Release

RUN mkdir -p /warehouse_ws/checkpoints /warehouse_ws/logs /warehouse_ws/experiment_results

COPY scripts/docker_entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["ros2", "launch", "warehouse_robot", "warehouse_system.launch.py"]