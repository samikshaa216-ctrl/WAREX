"""
Scalable Structured Logging — JSON lines, rotating files, in-memory ring buffer.
"""
import json
import time
import logging
import logging.handlers
import threading
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional


class StructuredFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: Dict[str, Any] = {
            'ts':    round(record.created, 3),
            'level': record.levelname,
            'logger': record.name,
            'msg':   record.getMessage(),
        }
        for k in ('robot_id', 'task_id', 'event', 'data'):
            if hasattr(record, k):
                entry[k] = getattr(record, k)
        if record.exc_info:
            entry['exc'] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


class RingBufferHandler(logging.Handler):
    def __init__(self, capacity: int = 1000):
        super().__init__()
        self._buf  = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord):
        entry = {'ts': round(record.created, 3), 'level': record.levelname,
                 'logger': record.name, 'msg': record.getMessage()}
        for k in ('robot_id', 'task_id', 'event'):
            if hasattr(record, k):
                entry[k] = getattr(record, k)
        with self._lock:
            self._buf.append(entry)

    def query(self, n: int = 100, level: Optional[str] = None,
              robot_id: Optional[str] = None, event: Optional[str] = None,
              since_ts: Optional[float] = None) -> List[Dict[str, Any]]:
        with self._lock:
            records = list(self._buf)
        if level:
            records = [r for r in records if r.get('level') == level.upper()]
        if robot_id:
            records = [r for r in records if r.get('robot_id') == robot_id]
        if event:
            records = [r for r in records if r.get('event') == event]
        if since_ts is not None:
            records = [r for r in records if r.get('ts', 0) >= since_ts]
        return records[-n:]


_ring_handler: Optional[RingBufferHandler] = None
_configured   = False
_cfg_lock     = threading.Lock()


def configure_logging(log_dir: str = '~/warehouse_ws/logs',
                      level: str = 'INFO', buffer_size: int = 2000,
                      max_file_mb: int = 50, backup_count: int = 5,
                      console: bool = True) -> RingBufferHandler:
    global _ring_handler, _configured
    with _cfg_lock:
        if _configured:
            return _ring_handler
        log_path = Path(log_dir).expanduser()
        log_path.mkdir(parents=True, exist_ok=True)
        root = logging.getLogger()
        root.setLevel(getattr(logging, level.upper(), logging.INFO))
        fmt  = StructuredFormatter()
        if console:
            ch = logging.StreamHandler()
            ch.setFormatter(fmt)
            root.addHandler(ch)
        fh = logging.handlers.RotatingFileHandler(
            log_path / 'warehouse.jsonl',
            maxBytes=max_file_mb * 1024 * 1024,
            backupCount=backup_count, encoding='utf-8')
        fh.setFormatter(fmt)
        root.addHandler(fh)
        eh = logging.handlers.RotatingFileHandler(
            log_path / 'warehouse_errors.jsonl',
            maxBytes=10 * 1024 * 1024, backupCount=3, encoding='utf-8')
        eh.setLevel(logging.ERROR)
        eh.setFormatter(fmt)
        root.addHandler(eh)
        _ring_handler = RingBufferHandler(capacity=buffer_size)
        root.addHandler(_ring_handler)
        _configured = True
        return _ring_handler


def get_ring_buffer() -> Optional[RingBufferHandler]:
    return _ring_handler


class RobotLogger:
    def __init__(self, robot_id: str):
        self.robot_id = robot_id
        self._log     = logging.getLogger(f'robot.{robot_id}')

    def _extra(self, kwargs):
        extra = {'robot_id': self.robot_id}
        for k in ('task_id', 'event', 'data'):
            if k in kwargs:
                extra[k] = kwargs.pop(k)
        return extra

    def debug(self, msg, **kw):    self._log.debug(msg,    extra=self._extra(kw))
    def info(self, msg, **kw):     self._log.info(msg,     extra=self._extra(kw))
    def warning(self, msg, **kw):  self._log.warning(msg,  extra=self._extra(kw))
    def error(self, msg, **kw):    self._log.error(msg,    extra=self._extra(kw))
    def critical(self, msg, **kw): self._log.critical(msg, extra=self._extra(kw))


def query_logs(n: int = 100, level: Optional[str] = None,
               robot_id: Optional[str] = None, event: Optional[str] = None,
               since_ts: Optional[float] = None) -> List[Dict[str, Any]]:
    if _ring_handler is None:
        return []
    return _ring_handler.query(n=n, level=level, robot_id=robot_id,
                               event=event, since_ts=since_ts)