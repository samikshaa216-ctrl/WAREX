"""
Network Latency & Packet Loss Simulation
Presets: GOOD / DEGRADED / POOR / OFFLINE
"""
import time
import random
import threading
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, Optional, Tuple

log = logging.getLogger(__name__)


class NetworkCondition(Enum):
    GOOD     = 'GOOD'
    DEGRADED = 'DEGRADED'
    POOR     = 'POOR'
    OFFLINE  = 'OFFLINE'


_PRESETS: Dict[NetworkCondition, Dict[str, float]] = {
    NetworkCondition.GOOD:     {'latency_ms': 5.0,   'jitter_ms': 2.0,   'loss_rate': 0.001},
    NetworkCondition.DEGRADED: {'latency_ms': 40.0,  'jitter_ms': 15.0,  'loss_rate': 0.05},
    NetworkCondition.POOR:     {'latency_ms': 120.0, 'jitter_ms': 50.0,  'loss_rate': 0.15},
    NetworkCondition.OFFLINE:  {'latency_ms': 0.0,   'jitter_ms': 0.0,   'loss_rate': 1.0},
}


@dataclass
class NetworkProfile:
    latency_ms: float = 10.0
    jitter_ms:  float = 5.0
    loss_rate:  float = 0.01
    enabled:    bool  = True

    @classmethod
    def from_condition(cls, c: NetworkCondition) -> 'NetworkProfile':
        return cls(**_PRESETS[c])

    def quality_score(self) -> float:
        if not self.enabled or self.loss_rate >= 1.0:
            return 0.0
        return (max(0.0, 1.0 - self.latency_ms / 200.0) + 1.0 - self.loss_rate) / 2.0


@dataclass
class NetworkStats:
    packets_sent:     int   = 0
    packets_dropped:  int   = 0
    total_latency_ms: float = 0.0
    peak_latency_ms:  float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, dropped: bool, latency_ms: float):
        with self._lock:
            self.packets_sent += 1
            if dropped:
                self.packets_dropped += 1
            else:
                self.total_latency_ms += latency_ms
                self.peak_latency_ms   = max(self.peak_latency_ms, latency_ms)

    def to_dict(self):
        with self._lock:
            sent = max(1, self.packets_sent - self.packets_dropped)
            avg  = self.total_latency_ms / sent if sent > 0 else 0.0
            return {
                'packets_sent':    self.packets_sent,
                'packets_dropped': self.packets_dropped,
                'loss_rate_actual': round(self.packets_dropped / max(1, self.packets_sent), 4),
                'avg_latency_ms':   round(avg, 2),
                'peak_latency_ms':  round(self.peak_latency_ms, 2),
            }


class NetworkSimulator:
    def __init__(self, profile: Optional[NetworkProfile] = None):
        self.profile = profile or NetworkProfile()
        self.stats   = NetworkStats()
        self._lock   = threading.Lock()

    def set_condition(self, condition: NetworkCondition):
        p = _PRESETS[condition]
        with self._lock:
            self.profile.latency_ms = p['latency_ms']
            self.profile.jitter_ms  = p['jitter_ms']
            self.profile.loss_rate  = p['loss_rate']
            self.profile.enabled    = (condition != NetworkCondition.OFFLINE)

    def set_params(self, latency_ms: float, jitter_ms: float, loss_rate: float):
        with self._lock:
            self.profile.latency_ms = latency_ms
            self.profile.jitter_ms  = jitter_ms
            self.profile.loss_rate  = max(0.0, min(1.0, loss_rate))

    def simulate_send(self, fn: Callable, *args, **kwargs) -> Tuple[bool, Any]:
        with self._lock:
            enabled    = self.profile.enabled
            loss_rate  = self.profile.loss_rate
            latency_ms = self.profile.latency_ms
            jitter_ms  = self.profile.jitter_ms

        if not enabled:
            self.stats.record(dropped=True, latency_ms=0.0)
            return False, None

        if random.random() < loss_rate:
            self.stats.record(dropped=True, latency_ms=0.0)
            return False, None

        jitter   = random.gauss(0.0, jitter_ms)
        lat_s    = max(0.0, latency_ms + jitter) / 1000.0
        time.sleep(lat_s)
        self.stats.record(dropped=False, latency_ms=lat_s * 1000.0)
        result = fn(*args, **kwargs)
        return True, result

    def quality_score(self) -> float:
        with self._lock:
            return self.profile.quality_score()

    def get_stats(self) -> Dict[str, Any]:
        d = self.stats.to_dict()
        with self._lock:
            d['quality_score']      = round(self.profile.quality_score(), 3)
            d['current_latency_ms'] = self.profile.latency_ms
            d['current_loss_rate']  = self.profile.loss_rate
            d['enabled']            = self.profile.enabled
        return d

    def reset_stats(self):
        self.stats = NetworkStats()


_simulators: Dict[str, NetworkSimulator] = {}
_sim_lock   = threading.Lock()


def get_simulator(robot_id: str) -> NetworkSimulator:
    with _sim_lock:
        if robot_id not in _simulators:
            _simulators[robot_id] = NetworkSimulator()
        return _simulators[robot_id]


def set_fleet_condition(condition: NetworkCondition):
    with _sim_lock:
        for sim in _simulators.values():
            sim.set_condition(condition)


def fleet_stats() -> Dict[str, Any]:
    with _sim_lock:
        return {rid: sim.get_stats() for rid, sim in _simulators.items()}