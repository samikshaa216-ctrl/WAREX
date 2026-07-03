"""
Digital Twin Updater Node

Subscribes to /robot_state (warehouse_interfaces/RobotState) and writes
every update into the DigitalTwinFeed singleton.

This runs in the SAME process as api/gateway.py (via the GatewayNode).
The gateway launches uvicorn in a background thread and this ROS node
runs on the main thread — they share the same Python process memory,
so the singleton DigitalTwinFeed is truly shared.

Standalone entry point (if needed for debugging):
    ros2 run warehouse_robot twin_updater
"""
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import json

from warehouse_interfaces.msg import RobotState
from warehouse_robot.digital_twin.twin_feed import get_twin


class TwinUpdater(Node):
    """
    Bridge node: ROS2 /robot_state topic → DigitalTwinFeed singleton.
    Also subscribes to warehouse_graph topic to populate layout in twin.
    """

    def __init__(self):
        super().__init__('twin_updater')

        self.twin = get_twin()

        # Primary subscription: structured robot state from enhanced robot nodes
        self.create_subscription(
            RobotState,
            '/robot_state',
            self.robot_state_callback,
            10,
        )

        # Also subscribe to warehouse graph to populate twin layout
        self.create_subscription(
            String,
            'warehouse_graph',
            self.graph_callback,
            10,
        )

        self.get_logger().info('Digital Twin Updater started → listening on /robot_state')

    def robot_state_callback(self, msg: RobotState):
        """Every robot tick → update twin shadow state."""
        self.twin.update_robot(
            robot_id=msg.robot_id,
            x=float(msg.x),
            y=float(msg.y),
            status=msg.status,
            battery=float(msg.battery),
            task_id=msg.current_task if msg.current_task else None,
            goal_x=float(msg.goal_x) if msg.goal_x else None,
            goal_y=float(msg.goal_y) if msg.goal_y else None,
        )

    def graph_callback(self, msg: String):
        """Warehouse graph topology → store once in twin."""
        try:
            graph = json.loads(msg.data)
            self.twin.set_warehouse_graph(graph)
        except Exception as e:
            self.get_logger().error(f'Failed to parse warehouse graph: {e}')


def main(args=None):
    rclpy.init(args=args)
    node = TwinUpdater()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()