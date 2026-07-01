# Pantau SDK for Node.js

> **1 line. Auto-detect all endpoints. AI-ready monitoring.**

[![npm version](https://img.shields.io/npm/v/pantau-js.svg)](https://www.npmjs.com/package/pantau-js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

`pantau-js` automatically detects your Express routes and sends heartbeat data to [Pantau](https://pantau.dev) — the first MCP-native monitoring platform with WhatsApp alerts and Bahasa Indonesia support.

## Features

- **Zero-config auto-detection** — drops into any Express app, discovers all routes automatically
- **Periodic heartbeat** — sends latency + status code data every 30 seconds
- **Never crashes your app** — all failures are silently caught
- **Zero production dependencies** — only uses built-in `http` and `fetch`
- **TypeScript-first** — full type definitions included
- **Open source** — transparent, auditable, MIT licensed

## Quick Start

```bash
npm install pantau-js
```

```js
const express = require('express');
const pantau = require('pantau-js');

// 1. Initialize (get your API key from https://pantau.dev)
pantau.init({
  apiKey: 'pk_your_api_key_here',
  serviceName: 'my-api',
});

const app = express();

// 2. Add middleware — auto-detects all routes
app.use(pantau.middleware());

app.get('/users', (req, res) => res.json([{ id: 1 }]));
app.post('/orders', (req, res) => res.status(201).json({ ok: true }));

// 3. Start heartbeat (sends data every 30s)
pantau.startHeartbeat();

app.listen(3000, () => console.log('Server running + monitored by Pantau'));
```

That's it. Your dashboard at [pantau.dev](https://pantau.dev) will show all endpoints within seconds.

## API Reference

### `pantau.init(config)`

Initialize the SDK. Call once at app startup.

```ts
interface PantauConfig {
  apiKey: string;        // Your Pantau API key (from dashboard)
  serviceName: string;   // Name of this service
  baseUrl?: string;      // Pantau API URL (default: http://localhost:3001)
}
```

### `pantau.middleware()`

Returns Express middleware that tracks response time and status code for every request.

```js
app.use(pantau.middleware());
```

Place AFTER any body parsers but BEFORE your routes for most accurate timing.

### `pantau.startHeartbeat(intervalMs?)`

Starts periodic heartbeat reporting. Default interval: 30 seconds (30000ms).

```js
pantau.startHeartbeat();         // every 30s
pantau.startHeartbeat(60000);    // every 60s
```

### `pantau.stopHeartbeat()`

Stops the heartbeat interval.

### `pantau.shutdown()`

Graceful shutdown — stops heartbeat and sends final data.

```js
process.on('SIGTERM', async () => {
  await pantau.shutdown();
  process.exit(0);
});
```

## How it works

```
┌─────────────────┐
│  Your Express App │
│  app.use(pantau  │
│    .middleware()) │
└────────┬────────┘
         │ Every request: track method, path, status, latency
         │ Every 30s: aggregate stats → POST to Pantau API
         ▼
┌─────────────────┐
│  Pantau API      │  POST /api/ingest
│  (pantau.dev)    │  x-api-key: pk_...
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Your Dashboard  │  All endpoints, uptime, latency, errors
│  pantau.dev      │  WhatsApp alerts when something breaks
└─────────────────┘
```

## What data we send

Only what's needed for monitoring:

```json
{
  "service": "my-api",
  "endpoints": [
    {
      "method": "GET",
      "path": "/users",
      "statusCode": 200,
      "responseTimeMs": 42
    }
  ]
}
```

**We never send:** request body, headers, query strings, or any PII.

## Self-hosting

Pantau is open source. You can run the API on your own server:

```js
pantau.init({
  apiKey: 'pk_...',
  serviceName: 'my-api',
  baseUrl: 'https://pantau.your-company.com',  // your self-hosted instance
});
```

## Requirements

- Node.js >= 18
- Express >= 4.0

## License

MIT © [Arief](https://github.com/ariefbudhima)

---

**[Pantau](https://pantau.dev)** — Monitoring built for how Indonesian teams actually work.
