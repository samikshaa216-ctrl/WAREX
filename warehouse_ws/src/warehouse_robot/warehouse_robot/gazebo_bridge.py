#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from warehouse_interfaces.msg import RobotStatus
import math

# Backend grid coordinates → Gazebo world coordinates
CELL_SIZE = 0.5  # 0.5 meters per grid cell

def grid_to_world(grid_x, grid_y):
    """Convert backend grid to Gazebo world coordinates"""
    return (grid_x * CELL_SIZE, grid_y * CELL_SIZE)


class GazeboBridge(Node):
    def __init__(self):
        super().__init__('gazebo_bridge')
        
        self.robot_namespaces = [f'robot_{str(i+1).zfill(3)}' for i in range(6)]
        
        # Store robot states
        self.robot_goals = {}  # Target positions from backend (world coords)
        self.gazebo_positions = {}  # Current positions from Gazebo odometry
        self.last_logged = {}  # For debug logging throttle
        
        # Publishers: cmd_vel to Gazebo
        self.cmd_vel_pubs = {}
        for ns in self.robot_namespaces:
            topic = f'/{ns}/cmd_vel'
            self.cmd_vel_pubs[ns] = self.create_publisher(Twist, topic, 10)
            self.get_logger().info(f'📡 Publishing to {topic}')
        
        # Subscribers: Robot status from backend (grid coordinates)
        for ns in self.robot_namespaces:
            topic = f'/{ns}/status'
            self.create_subscription(
                RobotStatus,
                topic,
                lambda msg, robot_ns=ns: self.status_callback(msg, robot_ns),
                10
            )
            self.get_logger().info(f'🎧 Backend status: {topic}')
        
        # Subscribers: Odometry from Gazebo (world coordinates)
        for ns in self.robot_namespaces:
            topic = f'/{ns}/odom'
            self.create_subscription(
                Odometry,
                topic,
                lambda msg, robot_ns=ns: self.odom_callback(msg, robot_ns),
                10
            )
        
        # Control loop
        self.create_timer(0.1, self.control_loop)
        
        self.get_logger().info('=' * 70)
        self.get_logger().info('🚀 WAREX Gazebo Bridge Started!')
        self.get_logger().info(f'🤖 Bridging {len(self.robot_namespaces)} robots')
        self.get_logger().info(f'📏 Grid→World: {CELL_SIZE}m per cell')
        self.get_logger().info('=' * 70)
    
    def status_callback(self, msg, robot_ns):
        """Backend publishes grid coordinates - convert to world"""
        world_x, world_y = grid_to_world(msg.x, msg.y)
        
        self.robot_goals[robot_ns] = {
            'x': world_x,
            'y': world_y,
            'grid_x': msg.x,
            'grid_y': msg.y,
            'status': msg.status
        }
        
        # Debug log (throttled to every 2 seconds per robot)
        now = self.get_clock().now().nanoseconds / 1e9
        if robot_ns not in self.last_logged or (now - self.last_logged[robot_ns]) > 2.0:
            self.get_logger().info(
                f'{robot_ns}: Grid({msg.x},{msg.y}) → World({world_x:.2f},{world_y:.2f}) | {msg.status}'
            )
            self.last_logged[robot_ns] = now
    
    def odom_callback(self, msg, robot_ns):
        """Gazebo publishes world coordinates"""
        pos = msg.pose.pose.position
        orientation = msg.pose.pose.orientation
        
        # Quaternion to yaw
        siny_cosp = 2 * (orientation.w * orientation.z + orientation.x * orientation.y)
        cosy_cosp = 1 - 2 * (orientation.y**2 + orientation.z**2)
        theta = math.atan2(siny_cosp, cosy_cosp)
        
        self.gazebo_positions[robot_ns] = {
            'x': pos.x,
            'y': pos.y,
            'theta': theta
        }
    
    def control_loop(self):
        """Main control loop - runs at 10Hz"""
        for robot_ns in self.robot_namespaces:
            self.move_robot(robot_ns)
    
    def move_robot(self, robot_ns):
        """Calculate and publish velocity commands"""
        if robot_ns not in self.gazebo_positions or robot_ns not in self.robot_goals:
            return
        
        current = self.gazebo_positions[robot_ns]
        goal = self.robot_goals[robot_ns]
        
        # Calculate distance to goal
        dx = goal['x'] - current['x']
        dy = goal['y'] - current['y']
        distance = math.sqrt(dx**2 + dy**2)
        
        twist = Twist()
        
        TOLERANCE = 0.15  # 15cm position tolerance
        
        if distance > TOLERANCE:
            # Calculate desired heading
            desired_theta = math.atan2(dy, dx)
            theta_error = self.normalize_angle(desired_theta - current['theta'])
            
            # Proportional control
            MAX_LINEAR = 0.22  # m/s
            MAX_ANGULAR = 2.0  # rad/s
            
            # Linear velocity proportional to distance
            twist.linear.x = min(MAX_LINEAR, distance * 1.0)
            
            # Angular velocity proportional to heading error
            twist.angular.z = max(-MAX_ANGULAR, min(MAX_ANGULAR, theta_error * 4.0))
            
            # Slow down when turning
            if abs(theta_error) > 0.5:  # >28 degrees
                twist.linear.x *= 0.3
        
        # Publish velocity command
        self.cmd_vel_pubs[robot_ns].publish(twist)
    
    def normalize_angle(self, angle):
        """Normalize angle to [-pi, pi]"""
        while angle > math.pi:
            angle -= 2 * math.pi
        while angle < -math.pi:
            angle += 2 * math.pi
        return angle


def main(args=None):
    rclpy.init(args=args)
    node = GazeboBridge()
    
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        node.get_logger().info('🛑 Shutting down Gazebo Bridge')
    finally:
        # Stop all robots
        for ns, pub in node.cmd_vel_pubs.items():
            stop = Twist()
            pub.publish(stop)
        
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
