"""Pantau MCP Server — expose monitoring data to AI assistants via Model Context Protocol.

Start: PANTU_API_URL=http://localhost:3001 PANTU_JWT=<token> python main.py
Stdio transport — no network port needed. Claude/Cursor exec this directly.
"""

import os
import httpx
from mcp.server.fastmcp import FastMCP

# ── Config ────────────────────────────────────────────────────────────────────
API_URL = os.environ["PANTU_API_URL"].rstrip("/")
JWT = os.environ["PANTU_JWT"]
HEADERS = {"Authorization": f"Bearer {JWT}", "Accept": "application/json"}

mcp = FastMCP(
    name="Pantau Monitoring",
    instructions="Use the Pantau MCP tools to check endpoint status, view heartbeats, query logs, and get aggregate stats for your Pantau monitoring instance.",
)

client = httpx.Client(timeout=30)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _get(path: str, **params) -> dict:
    """GET a Pantau API path, return JSON body or raise."""
    r = client.get(f"{API_URL}{path}", headers=HEADERS, params=params)
    r.raise_for_status()
    return r.json()


# ── Tools ─────────────────────────────────────────────────────────────────────
@mcp.tool(
    name="health_check",
    description="Ping the Pantau API health endpoint. Returns status and server time.",
)
def health_check() -> dict:
    return _get("/health")


@mcp.tool(
    name="list_endpoints",
    description="List all monitored endpoints for the authenticated user. Returns name, method, path, type (auto/manual), status (up/down/unknown), and last check time.",
)
def list_endpoints() -> dict:
    """GET /api/endpoints — all endpoints with health status."""
    return _get("/api/endpoints")


@mcp.tool(
    name="get_heartbeats",
    description="Get recent 100 heartbeats for a specific endpoint. Returns each check's status_code, response_time_ms, status (up/down), error_message, and aggregates: total, up, down, uptime_pct.",
)
def get_heartbeats(endpoint_id: int) -> dict:
    """GET /api/heartbeats/:endpointId — recent 100 checks + uptime stats."""
    return _get(f"/api/heartbeats/{endpoint_id}")


@mcp.tool(
    name="query_logs",
    description="Search request logs with optional filters. Returns most recent logs first, up to `limit` (max 500). Filters: endpointId, method, status (2xx/4xx/5xx), q (path search), bodyq (PII hash search), since (ISO timestamp). Default time window determined by user tier retention.",
)
def query_logs(
    endpoint_id: int | None = None,
    method: str | None = None,
    status: str | None = None,
    q: str | None = None,
    since: str | None = None,
    limit: int = 100,
) -> dict:
    """GET /api/logs — searchable request logs."""
    params: dict = {"limit": limit}
    if endpoint_id:
        params["endpointId"] = str(endpoint_id)
    if method:
        params["method"] = method
    if status:
        params["status"] = status
    if q:
        params["q"] = q
    if since:
        params["since"] = since
    return _get("/api/logs", **params)


@mcp.tool(
    name="get_logs_stats",
    description="Get aggregate request log statistics: total requests, errors, error_rate %, avg_ms, p95_ms, and a time histogram (bucketed ok/warn/err counts). Accepts same filters as query_logs. Use buckets to control histogram granularity (default 40, max 200).",
)
def get_logs_stats(
    endpoint_id: int | None = None,
    status: str | None = None,
    since: str | None = None,
    buckets: int = 40,
) -> dict:
    """GET /api/logs/stats — aggregates + histogram."""
    params: dict = {"buckets": buckets}
    if endpoint_id:
        params["endpointId"] = str(endpoint_id)
    if status:
        params["status"] = status
    if since:
        params["since"] = since
    return _get("/api/logs/stats", **params)


# ── Entry ─────────────────────────────────────────────────────────────────────
def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
