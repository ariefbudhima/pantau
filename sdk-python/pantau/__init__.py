# Pantau Python SDK — observability in 1 line of code.
# Usage:
#   import pantau
#   pantau.init(api_key="pk_xxx", service_name="my-api")
#
#   # FastAPI:
#   app.middleware("http")(pantau.middleware)
#
#   # Flask:
#   app.before_request(pantau.start_request)
#   app.after_request(pantau.end_request)

from .client import init, middleware, start_heartbeat, stop_heartbeat, shutdown
from .redact import redact_body, redact_headers, hash_value, REDACTED

__all__ = [
    "init",
    "middleware",
    "start_heartbeat",
    "stop_heartbeat",
    "shutdown",
    "redact_body",
    "redact_headers",
    "hash_value",
    "REDACTED",
]
