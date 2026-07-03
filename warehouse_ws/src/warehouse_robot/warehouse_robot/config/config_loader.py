"""Configuration loader — YAML + env variable override."""
import os
import yaml
from pathlib import Path
from typing import Any, Dict, Optional
from dataclasses import dataclass, field


@dataclass
class BatteryConfig:
    initial_level: float = 100.0
    nominal_voltage: float = 48.0
    capacity_ah: float = 50.0
    critical_threshold: float = 20.0
    low_threshold: float = 40.0
    discharge_rate_idle: float = 0.5
    discharge_rate_moving: float = 2.0
    discharge_rate_carrying: float = 3.5
    charge_rate: float = 10.0


@dataclass
class WarehouseConfig:
    grid_width: int = 50
    grid_height: int = 30
    cell_size: float = 1.0
    charging_stations: int = 3
    charging_station_positions: list = field(
        default_factory=lambda: [(5, 5), (45, 5), (25, 25)])


@dataclass
class SchedulingConfig:
    algorithm: str = 'battery_aware_edf'
    task_timeout: float = 300.0
    battery_reserve: float = 15.0
    max_retries: int = 3
    deadline_slack: float = 3.5


@dataclass
class NetworkConfig:
    enable_latency_sim: bool = True
    base_latency_ms: float = 10.0
    jitter_ms: float = 5.0
    packet_loss_rate: float = 0.01
    default_condition: str = 'GOOD'


@dataclass
class DatabaseConfig:
    redis_host: str = 'localhost'
    redis_port: int = 6379
    redis_db: int = 0
    mongo_uri: str = 'mongodb://localhost:27017'
    mongo_db: str = 'warehouse_robotics'
    minio_endpoint: str = 'http://localhost:9000'
    minio_access_key: str = 'minioadmin'
    minio_secret_key: str = 'minioadmin123'
    s3_bucket: str = 'robot-checkpoints'


@dataclass
class Config:
    num_robots: int = 6
    battery: BatteryConfig = field(default_factory=BatteryConfig)
    warehouse: WarehouseConfig = field(default_factory=WarehouseConfig)
    scheduling: SchedulingConfig = field(default_factory=SchedulingConfig)
    network: NetworkConfig = field(default_factory=NetworkConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)

    @classmethod
    def from_yaml(cls, path: str) -> 'Config':
        with open(path) as f:
            d = yaml.safe_load(f) or {}
        cfg = cls()
        cfg.num_robots = d.get('system', {}).get('num_robots', cfg.num_robots)
        if 'battery' in d:
            cfg.battery = BatteryConfig(**{
                k: v for k, v in d['battery'].items()
                if hasattr(BatteryConfig, k)})
        if 'warehouse' in d:
            cfg.warehouse = WarehouseConfig(**{
                k: v for k, v in d['warehouse'].items()
                if hasattr(WarehouseConfig, k)})
        if 'scheduling' in d:
            cfg.scheduling = SchedulingConfig(**{
                k: v for k, v in d['scheduling'].items()
                if hasattr(SchedulingConfig, k)})
        if 'network' in d:
            cfg.network = NetworkConfig(**{
                k: v for k, v in d['network'].items()
                if hasattr(NetworkConfig, k)})
        if 'database' in d:
            cfg.database = DatabaseConfig(**{
                k: v for k, v in d['database'].items()
                if hasattr(DatabaseConfig, k)})
        return cfg

    @classmethod
    def from_env(cls) -> 'Config':
        cfg = cls()
        if 'NUM_ROBOTS' in os.environ:
            cfg.num_robots = int(os.environ['NUM_ROBOTS'])
        if 'REDIS_HOST' in os.environ:
            cfg.database.redis_host = os.environ['REDIS_HOST']
        if 'MONGODB_URI' in os.environ:
            cfg.database.mongo_uri = os.environ['MONGODB_URI']
        if 'MINIO_ENDPOINT' in os.environ:
            cfg.database.minio_endpoint = os.environ['MINIO_ENDPOINT']
        if 'MINIO_ACCESS_KEY' in os.environ:
            cfg.database.minio_access_key = os.environ['MINIO_ACCESS_KEY']
        if 'MINIO_SECRET_KEY' in os.environ:
            cfg.database.minio_secret_key = os.environ['MINIO_SECRET_KEY']
        return cfg

    def to_dict(self) -> Dict[str, Any]:
        return {
            'num_robots': self.num_robots,
            'battery':    self.battery.__dict__,
            'warehouse':  self.warehouse.__dict__,
            'scheduling': self.scheduling.__dict__,
            'network':    self.network.__dict__,
            'database':   self.database.__dict__,
        }


_config: Optional[Config] = None


def get_config(yaml_path: Optional[str] = None) -> Config:
    global _config
    if _config is not None:
        return _config
    default_yaml = Path.home() / 'warehouse_ws' / 'config' / 'warehouse_params.yaml'
    path = yaml_path or str(default_yaml)
    if os.path.exists(path):
        _config = Config.from_yaml(path)
    else:
        _config = Config()
    env_cfg = Config.from_env()
    _config.num_robots     = env_cfg.num_robots
    _config.database       = env_cfg.database
    return _config