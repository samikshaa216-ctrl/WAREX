"""
Cloud Persistence Layer — MongoDB + S3/MinIO + local JSON fallback.
"""
import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

try:
    from motor.motor_asyncio import AsyncIOMotorClient
    MONGODB_AVAILABLE = True
except ImportError:
    MONGODB_AVAILABLE = False

try:
    import aioboto3
    S3_AVAILABLE = True
except ImportError:
    S3_AVAILABLE = False


class CloudPersistence:
    def __init__(self):
        self._db        = None
        self._s3        = None
        self._s3_bucket = os.getenv('S3_BUCKET', 'robot-checkpoints')
        self._s3_ep     = os.getenv('MINIO_ENDPOINT', 'http://localhost:9000')

        base = Path(os.getenv('WAREHOUSE_DATA_DIR', '~/warehouse_ws')).expanduser()
        self._metrics_dir  = base / 'logs' / 'metrics'
        self._ckpt_dir     = base / 'checkpoints'
        self._exp_dir      = base / 'experiment_results'
        for d in (self._metrics_dir, self._ckpt_dir, self._exp_dir):
            d.mkdir(parents=True, exist_ok=True)

        if MONGODB_AVAILABLE:
            uri = os.getenv('MONGODB_URI', 'mongodb://localhost:27017')
            try:
                client   = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=3000)
                self._db = client.warehouse_robotics
            except Exception as e:
                log.warning(f'MongoDB init failed: {e}')

        if S3_AVAILABLE:
            self._s3 = aioboto3.Session(
                aws_access_key_id=os.getenv('MINIO_ACCESS_KEY', 'minioadmin'),
                aws_secret_access_key=os.getenv('MINIO_SECRET_KEY', 'minioadmin123'),
                region_name='us-east-1',
            )

    async def store_metrics(self, metrics: Dict[str, Any]) -> bool:
        metrics['_ts'] = time.time()
        if self._db is not None:
            try:
                await self._db.metrics.insert_one(dict(metrics))
                return True
            except Exception as e:
                log.warning(f'MongoDB store_metrics: {e}')
        return self._local_append(self._metrics_dir / 'metrics.jsonl', metrics)

    async def store_checkpoint(self, ckpt_id: str, data: bytes) -> bool:
        if self._s3 is not None:
            try:
                async with self._s3.client('s3', endpoint_url=self._s3_ep) as s3:
                    await s3.put_object(Bucket=self._s3_bucket,
                                        Key=f'checkpoints/{ckpt_id}', Body=data)
                return True
            except Exception as e:
                log.warning(f'S3 store_checkpoint: {e}')
        path = self._ckpt_dir / f'{ckpt_id}.pkl'
        try:
            path.write_bytes(data)
            return True
        except Exception as e:
            log.error(f'Local store_checkpoint: {e}')
            return False

    async def get_checkpoint(self, ckpt_id: str) -> Optional[bytes]:
        if self._s3 is not None:
            try:
                async with self._s3.client('s3', endpoint_url=self._s3_ep) as s3:
                    r = await s3.get_object(Bucket=self._s3_bucket,
                                            Key=f'checkpoints/{ckpt_id}')
                    return await r['Body'].read()
            except Exception:
                pass
        path = self._ckpt_dir / f'{ckpt_id}.pkl'
        return path.read_bytes() if path.exists() else None

    async def store_experiment_result(self, result: Dict[str, Any]) -> bool:
        result['_ts'] = time.time()
        if self._db is not None:
            try:
                await self._db.experiment_results.insert_one(dict(result))
                return True
            except Exception as e:
                log.warning(f'MongoDB store_experiment_result: {e}')
        return self._local_append(self._exp_dir / 'experiment_results.jsonl', result)

    async def query_metrics(self, query: Dict[str, Any] = None, limit: int = 100) -> List:
        if self._db is not None:
            try:
                cursor = self._db.metrics.find(query or {}, {'_id': 0}).limit(limit)
                return await cursor.to_list(length=limit)
            except Exception as e:
                log.warning(f'MongoDB query_metrics: {e}')
        return []

    async def health(self) -> Dict[str, Any]:
        mongo_ok, s3_ok = False, False
        if self._db is not None:
            try:
                await self._db.client.admin.command('ping')
                mongo_ok = True
            except Exception:
                pass
        if self._s3 is not None:
            try:
                async with self._s3.client('s3', endpoint_url=self._s3_ep) as s3:
                    await s3.list_buckets()
                    s3_ok = True
            except Exception:
                pass
        return {'mongodb': 'ok' if mongo_ok else 'unavailable',
                's3': 'ok' if s3_ok else 'unavailable', 'local': 'ok'}

    @staticmethod
    def _local_append(path: Path, record: Dict[str, Any]) -> bool:
        try:
            with open(path, 'a') as f:
                f.write(json.dumps(record, default=str) + '\n')
            return True
        except Exception as e:
            log.error(f'Local append to {path}: {e}')
            return False


_instance: Optional[CloudPersistence] = None


def get_cloud() -> CloudPersistence:
    global _instance
    if _instance is None:
        _instance = CloudPersistence()
    return _instance