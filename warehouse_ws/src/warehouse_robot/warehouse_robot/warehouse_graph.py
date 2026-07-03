"""
Warehouse Graph Node
Publishes the static topology as a JSON string on /warehouse_graph.
Consumed by the simulation engine and any subscribers that want the layout.
"""
import json
import rclpy
from rclpy.node import Node
from std_msgs.msg import String

# ── Static topology (matches WarehouseMap.jsx) ────────────────────────────────
WAREHOUSE_GRAPH = {
    'C1':  (1,  1),   'C2':  (2,  1),
    'C3':  (1, 27),   'C4':  (2, 27),
    'DZ1': (27, 26),  'DZ2': (28, 26),
    'DZ3': (27, 27),  'DZ4': (28, 27),
    # Shelf zones (representative corners)
    'SH_TL': ( 3,  3), 'SH_TR': (18,  3),
    'SH_ML': ( 3, 13), 'SH_MR': (18, 13),
    'SH_BT': (22, 21),
}

CHARGING_DOCKS = ['C1', 'C2', 'C3', 'C4']
DROP_ZONES     = ['DZ1', 'DZ2', 'DZ3', 'DZ4']

_PAYLOAD = json.dumps({
    'nodes':          WAREHOUSE_GRAPH,
    'charging_docks': CHARGING_DOCKS,
    'drop_zones':     DROP_ZONES,
    'grid_width':     30,
    'grid_height':    30,
})


class WarehouseGraphNode(Node):
    def __init__(self):
        super().__init__('warehouse_graph')
        self._pub = self.create_publisher(String, 'warehouse_graph', 10)
        self.create_timer(5.0, self._publish)
        self._publish()
        self.get_logger().info(
            f'WarehouseGraph started | '
            f'{len(WAREHOUSE_GRAPH)} nodes | '
            f'{len(CHARGING_DOCKS)} charging docks | '
            f'{len(DROP_ZONES)} drop zones')

    def _publish(self):
        msg      = String()
        msg.data = _PAYLOAD
        self._pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = WarehouseGraphNode()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == '__main__':
    main()