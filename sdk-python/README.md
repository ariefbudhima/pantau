# Pantau Python SDK

**Observability in 1 line.** Auto-detect routes. WhatsApp alerts. MCP integration.

```python
import pantau

pantau.init(
    api_key="pk_xxx",
    service_name="my-api",
)
```

## Usage

### FastAPI

```python
from fastapi import FastAPI
import pantau

app = FastAPI()
pantau.init(api_key="pk_xxx", service_name="fastapi-app")

@app.middleware("http")
async def pantau_middleware(request, call_next):
    return await pantau.middleware()(request, call_next)

@app.get("/users/{id}")
def get_user(id: int):
    return {"id": id, "name": "Budi"}
```

### Flask

```python
from flask import Flask, request
import pantau
import time

app = Flask(__name__)
pantau.init(api_key="pk_xxx", service_name="flask-app")

@app.before_request
def start_timer():
    request._pantau_start = time.time()

@app.after_request
def track(response):
    import pantau
    dt_ms = int((time.time() - request._pantau_start) * 1000)
    # Manual track — auto middleware for Flask coming soon
    return response

@app.route("/health")
def health():
    return {"status": "ok"}
```

## Installation

```bash
pip install pantau-py
```

For development:

```bash
cd sdk-python
pip install -e .
pytest
```
