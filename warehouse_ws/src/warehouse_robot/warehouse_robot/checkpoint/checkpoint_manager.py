"""
Multi-Tier Adaptive Checkpoint Manager
Tiers: Local (memory) → Edge (Redis) → Cloud (S3/MinIO)
"""
import pickle
import zlib
import time
import json
import hashlib
from typing import Dict, Any, Optional, Tuple, List
from enum import Enum
from dataclasses import dataclass, asdict

try:
    import redis as _redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

try:
    import boto3
    from botocore.exceptions import ClientError
    S3_AVAILABLE = True
except ImportError:
    S3_AVAILABLE = False


class CheckpointTier(Enum):
    LOCAL = 'local'
    EDGE  = 'edge'
    CLOUD = 'cloud'


@dataclass
class CheckpointMetadata:
    checkpoint_id: str
    robot_id:      str
    timestamp:     float
    tier:          CheckpointTier
    compressed:    bool
    size_bytes:    int
    state_hash:    str
    battery_level: float
    task_id:       Optional[str]
    network_quality: float

    def to_dict(self):
        d = asdict(self)
        d['tier'] = self.tier.value
        return d

    @classmethod
    def from_dict(cls, data):
        data = dict(data)
        data['tier'] = CheckpointTier(data['tier'])
        return cls(**data)


class CheckpointManager:

    def __init__(self, robot_id: str, config: Optional[Dict[str, Any]] = None):
        self.robot_id   = robot_id
        config          = config or {}
        self.COMPRESS   = config.get('compression', True)
        self.COMP_LEVEL = config.get('compression_level', 6)
        self.MAX_LOCAL  = config.get('max_local_checkpoints', 10)
        self.EDGE_TTL   = config.get('edge_ttl_seconds', 3600)
        self.CLOUD_BUCKET = config.get('cloud_bucket', 'robot-checkpoints')

        self.local_checkpoints: Dict[str, bytes]              = {}
        self.local_metadata:    Dict[str, CheckpointMetadata] = {}
        self.local_access:      Dict[str, float]              = {}

        self.redis_client   = None
        self.redis_ok       = False
        self.s3_client      = None
        self.s3_ok          = False

        if REDIS_AVAILABLE:
            try:
                self.redis_client = _redis.Redis(
                    host=config.get('redis_host', 'localhost'),
                    port=config.get('redis_port', 6379),
                    db=config.get('redis_db', 0),
                    socket_timeout=3.0, decode_responses=False)
                self.redis_client.ping()
                self.redis_ok = True
            except Exception:
                self.redis_ok = False

        if S3_AVAILABLE:
            try:
                self.s3_client = boto3.client(
                    's3',
                    endpoint_url=config.get('minio_endpoint', 'http://localhost:9000'),
                    aws_access_key_id=config.get('minio_access_key', 'minioadmin'),
                    aws_secret_access_key=config.get('minio_secret_key', 'minioadmin123'),
                )
                try:
                    self.s3_client.head_bucket(Bucket=self.CLOUD_BUCKET)
                except ClientError:
                    self.s3_client.create_bucket(Bucket=self.CLOUD_BUCKET)
                self.s3_ok = True
            except Exception:
                self.s3_ok = False

        self.stats = {'created': 0, 'restored': 0, 'local_hits': 0,
                      'edge_hits': 0, 'cloud_hits': 0, 'bytes_saved': 0}

    def create_checkpoint(self, state: Dict[str, Any],
                          tier: Optional[CheckpointTier] = None,
                          metadata: Optional[Dict[str, Any]] = None
                          ) -> Tuple[str, CheckpointMetadata]:
        ts       = time.time()
        ckpt_id  = f'{self.robot_id}_{int(ts * 1000)}'
        raw      = pickle.dumps(state, protocol=pickle.HIGHEST_PROTOCOL)
        orig_sz  = len(raw)
        h        = hashlib.md5(raw).hexdigest()
        data     = raw
        compressed = False
        if self.COMPRESS:
            c = zlib.compress(raw, level=self.COMP_LEVEL)
            if len(c) < orig_sz:
                data       = c
                compressed = True
        final_sz = len(data)

        meta_d   = metadata or {}
        if tier is None:
            tier = self._pick_tier(
                meta_d.get('battery_level', 50.0),
                meta_d.get('network_quality', 1.0),
                meta_d.get('task_priority', 3),
                final_sz,
            )

        ckpt_meta = CheckpointMetadata(
            checkpoint_id=ckpt_id, robot_id=self.robot_id,
            timestamp=ts, tier=tier, compressed=compressed,
            size_bytes=final_sz, state_hash=h,
            battery_level=meta_d.get('battery_level', 0.0),
            task_id=meta_d.get('task_id'), network_quality=meta_d.get('network_quality', 1.0),
        )

        if tier == CheckpointTier.LOCAL:
            self._store_local(ckpt_id, data, ckpt_meta)
        elif tier == CheckpointTier.EDGE:
            self._store_edge(ckpt_id, data, ckpt_meta)
        elif tier == CheckpointTier.CLOUD:
            self._store_cloud(ckpt_id, data, ckpt_meta)

        self.stats['created']    += 1
        self.stats['bytes_saved'] += final_sz
        return ckpt_id, ckpt_meta

    def restore_checkpoint(self, ckpt_id: str,
                           verify: bool = True) -> Optional[Dict[str, Any]]:
        data, meta = self._fetch_local(ckpt_id)
        if data:
            self.stats['local_hits'] += 1
        if data is None:
            data, meta = self._fetch_edge(ckpt_id)
            if data:
                self.stats['edge_hits'] += 1
                self._store_local(ckpt_id, data, meta)
        if data is None:
            data, meta = self._fetch_cloud(ckpt_id)
            if data:
                self.stats['cloud_hits'] += 1
                self._store_edge(ckpt_id, data, meta)
                self._store_local(ckpt_id, data, meta)
        if data is None:
            return None
        if meta and meta.compressed:
            try:
                data = zlib.decompress(data)
            except Exception:
                return None
        if verify and meta:
            if hashlib.md5(data).hexdigest() != meta.state_hash:
                return None
        try:
            state = pickle.loads(data)
            self.stats['restored'] += 1
            return state
        except Exception:
            return None

    def _pick_tier(self, battery, net_q, priority, size):
        if battery < 20.0:
            return CheckpointTier.CLOUD if self.s3_ok else CheckpointTier.LOCAL
        if priority >= 4 and self.s3_ok:
            return CheckpointTier.CLOUD
        if net_q < 0.3:
            return CheckpointTier.LOCAL
        if net_q > 0.8 and self.s3_ok:
            return CheckpointTier.CLOUD
        if self.redis_ok:
            return CheckpointTier.EDGE
        return CheckpointTier.LOCAL

    def _store_local(self, cid, data, meta):
        self.local_checkpoints[cid] = data
        self.local_metadata[cid]    = meta
        self.local_access[cid]      = time.time()
        if len(self.local_checkpoints) > self.MAX_LOCAL:
            oldest = min(self.local_access, key=self.local_access.get)
            self.local_checkpoints.pop(oldest, None)
            self.local_metadata.pop(oldest, None)
            self.local_access.pop(oldest, None)

    def _fetch_local(self, cid):
        if cid in self.local_checkpoints:
            self.local_access[cid] = time.time()
            return self.local_checkpoints[cid], self.local_metadata[cid]
        return None, None

    def _store_edge(self, cid, data, meta):
        if not self.redis_ok or not self.redis_client:
            self._store_local(cid, data, meta)
            return
        try:
            self.redis_client.setex(f'ckpt:data:{cid}', self.EDGE_TTL, data)
            self.redis_client.setex(f'ckpt:meta:{cid}', self.EDGE_TTL,
                                    json.dumps(meta.to_dict()))
        except Exception:
            self._store_local(cid, data, meta)

    def _fetch_edge(self, cid):
        if not self.redis_ok or not self.redis_client:
            return None, None
        try:
            data = self.redis_client.get(f'ckpt:data:{cid}')
            if data is None:
                return None, None
            m_raw = self.redis_client.get(f'ckpt:meta:{cid}')
            meta  = CheckpointMetadata.from_dict(json.loads(m_raw)) if m_raw else None
            return data, meta
        except Exception:
            return None, None

    def _store_cloud(self, cid, data, meta):
        if not self.s3_ok or not self.s3_client:
            self._store_edge(cid, data, meta)
            return
        try:
            self.s3_client.put_object(Bucket=self.CLOUD_BUCKET,
                                      Key=f'checkpoints/{self.robot_id}/{cid}.pkl',
                                      Body=data)
            self.s3_client.put_object(Bucket=self.CLOUD_BUCKET,
                                      Key=f'checkpoints/{self.robot_id}/{cid}.meta.json',
                                      Body=json.dumps(meta.to_dict()).encode())
        except Exception:
            self._store_edge(cid, data, meta)

    def _fetch_cloud(self, cid):
        if not self.s3_ok or not self.s3_client:
            return None, None
        try:
            r    = self.s3_client.get_object(Bucket=self.CLOUD_BUCKET,
                                              Key=f'checkpoints/{self.robot_id}/{cid}.pkl')
            data = r['Body'].read()
            try:
                mr   = self.s3_client.get_object(Bucket=self.CLOUD_BUCKET,
                                                  Key=f'checkpoints/{self.robot_id}/{cid}.meta.json')
                meta = CheckpointMetadata.from_dict(json.loads(mr['Body'].read()))
            except Exception:
                meta = None
            return data, meta
        except Exception:
            return None, None

    def adaptive_checkpoint_interval(self, battery: float,
                                     network_quality: float,
                                     task_complexity: float) -> float:
        interval = 30.0
        if battery < 30.0:
            interval = 5.0
        elif battery < 60.0:
            interval = 15.0
        if network_quality < 0.3:
            interval *= 2.0
        if task_complexity > 0.7:
            interval *= 0.5
        return max(5.0, min(60.0, interval))

    def get_stats(self):
        return {**self.stats, 'local_count': len(self.local_checkpoints),
                'redis_ok': self.redis_ok, 's3_ok': self.s3_ok}