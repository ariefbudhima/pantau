# Pantau MCP Server

Model Context Protocol server for [Pantau](https://github.com/ariefbudhima/pantau) monitoring.  
Expose your Pantau endpoints, heartbeats, logs, and stats to AI assistants (Claude Desktop, Cursor, etc.).

## Setup

```bash
pip install pantau-mcp
```

Or from source:

```bash
cd mcp
pip install -e .
```

Set environment variables:

```bash
export PANTU_API_URL=https://your-pantau-instance.com
export PANTU_JWT=your-jwt-token
```

Get a JWT token from Pantau → Settings → API Keys, or login via `POST /api/auth/login`.

## Tools

| Tool | Description |
|------|-------------|
| `list_endpoints` | All monitored endpoints with health status (up/down/unknown) |
| `get_heartbeats` | Recent 100 heartbeats for an endpoint + uptime stats |
| `query_logs` | Search request logs with filters (endpoint, status, method, query, time range) |
| `get_logs_stats` | Aggregate stats: total, error rate, avg/p95 latency, time histogram |
| `health_check` | API health ping |

## Claude Desktop config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pantau": {
      "command": "python",
      "args": ["/absolute/path/to/pantau/mcp/main.py"],
      "env": {
        "PANTU_API_URL": "https://pantau.example.com",
        "PANTU_JWT": "your-jwt-token"
      }
    }
  }
}
```

## Cursor config

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "pantau": {
      "command": "python",
      "args": ["/absolute/path/to/pantau/mcp/main.py"],
      "env": {
        "PANTU_API_URL": "http://localhost:3001",
        "PANTU_JWT": "your-jwt-token"
      }
    }
  }
}
```

## Auth

JWT token lasts 7 days. Rotate it via `POST /api/auth/login` when expired.  
The MCP server reads `PANTU_JWT` from env — no plaintext creds in config files required.
