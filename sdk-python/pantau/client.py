"""Pantau HTTP client — heartbeat batching + periodic flush."""

import json
import time
import threading
import urllib.request
import urllib.error
from typing import Any, Callable, Dict, List, Optional

from .redact import redact_body, redact_headers
from .path import normalize_path

# ── config ────────────────────────────────────────────────────────

class CaptureConfig:
    body: bool = False
    headers: bool = False
    deny_keys: Optional[List[str]] = None
    hash_keys: Optional[List[str]] = None
    partial_keys: Optional[List[str]] = None
    max_body_bytes: int = 8 * 1024  # 8 KiB

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            if hasattr(self, k):
                setattr(self, k, v)


class PantauConfig:
    api_key: str
    base_url: str = "http://localhost:3001"
    service_name: str
    capture: CaptureConfig

    def __init__(self, api_key: str, service_name: str,
                 base_url: str = "http://localhost:3001",
                 capture: Optional[CaptureConfig] = None):
        self.api_key = api_key
        self.service_name = service_name
        self.base_url = base_url
        self.capture = capture or CaptureConfig()


_config: Optional[PantauConfig] = None
_buffer: List[Dict[str, Any]] = []
_heartbeat_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()
_lock = threading.Lock()

MAX_BUFFER = 1000
DEFAULT_MAX_BODY = 8 * 1024

# ── public API ────────────────────────────────────────────────────

def init(api_key: str, service_name: str,
         base_url: str = "http://localhost:3001",
         capture: Optional[Dict] = None) -> None:
    """Initialize Pantau SDK. Call once at app startup."""
    global _config
    _config = PantauConfig(
        api_key=api_key,
        service_name=service_name,
        base_url=base_url,
        capture=CaptureConfig(**(capture or {})),
    )
    start_heartbeat()


def middleware():
    """ASGI middleware factory for FastAPI / Starlette.
    
    Usage:
        from fastapi import FastAPI
        import pantau
        app = FastAPI()
        app.middleware("http")(pantau.middleware)
    """
    
    async def asgi_middleware(request, call_next):
        if not _config:
            return await call_next(request)
            
        start = time.time()
        method = request.method
        path = normalize_path(request.url.path)
        
        response = await call_next(request)
        
        dt_ms = int((time.time() - start) * 1000)
        status = response.status_code
        
        ev = {
            "method": method,
            "path": path,
            "statusCode": status,
            "responseTimeMs": dt_ms,
            "errorMessage": f"HTTP {status}" if status >= 400 else None,
            "timestamp": _now_iso(),
        }
        
        cap = _config.capture
        if cap.body:
            # FastAPI request body
            try:
                body_bytes = await request.body()
                if body_bytes:
                    ev["requestBody"] = _clip(
                        redact_body(json.loads(body_bytes), _redact_opts(cap)),
                        cap.max_body_bytes,
                    )
            except Exception:
                pass
        
        _push(ev)
        return response
    
    return asgi_middleware


def start_heartbeat(interval_ms: int = 30_000) -> None:
    """Start periodic heartbeat flush (default every 30s)."""
    global _heartbeat_thread, _stop_event
    
    if _heartbeat_thread and _heartbeat_thread.is_alive():
        return  # already running
    
    _stop_event.clear()
    
    def _loop():
        while not _stop_event.wait(interval_ms / 1000):
            _flush()
    
    _heartbeat_thread = threading.Thread(target=_loop, daemon=True)
    _heartbeat_thread.start()


def stop_heartbeat() -> None:
    """Stop heartbeat thread."""
    _stop_event.set()


def shutdown() -> None:
    """Final flush + stop."""
    stop_heartbeat()
    _flush()


# ── internal ───────────────────────────────────────────────────────

def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def _redact_opts(cap: CaptureConfig) -> dict:
    return {
        "denyKeys": cap.deny_keys,
        "hashKeys": cap.hash_keys,
        "partialKeys": cap.partial_keys,
        "hashSecret": _config.api_key if _config else None,
    }


def _push(ev: Dict) -> None:
    global _buffer
    with _lock:
        _buffer.append(ev)
        if len(_buffer) > MAX_BUFFER:
            _buffer = _buffer[-MAX_BUFFER:]


def _clip(value: Any, max_bytes: int) -> Any:
    try:
        s = json.dumps(value)
        if len(s) <= max_bytes:
            return value
        return {"_truncated": True, "_bytes": len(s), "preview": s[:max_bytes]}
    except Exception:
        return {"_unserializable": True}


def _flush() -> None:
    global _buffer
    if not _config:
        return
    
    with _lock:
        if not _buffer:
            return
        batch = _buffer
        _buffer = []
    
    try:
        body = json.dumps({"service": _config.service_name, "events": batch}).encode()
        req = urllib.request.Request(
            f"{_config.base_url}/api/ingest",
            data=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": _config.api_key,
            },
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        if resp.status >= 400:
            print(f"[pantau] Flush failed: {resp.status}", file=__import__('sys').stderr)
            with _lock:
                _buffer = (batch + _buffer)[-MAX_BUFFER:]
    except Exception as e:
        print(f"[pantau] Flush error: {e}", file=__import__('sys').stderr)
        with _lock:
            _buffer = (batch + _buffer)[-MAX_BUFFER:]
