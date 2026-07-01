import { IncomingMessage, ServerResponse } from 'http';

interface PantauConfig {
  apiKey: string;
  baseUrl?: string;
  serviceName: string;
}

interface EndpointInfo {
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  errorMessage?: string;
}

let config: PantauConfig | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const endpointStats = new Map<string, { count: number; totalTime: number; errors: number }>();

/**
 * Initialize Pantau SDK. Call this once at app startup.
 */
export function init(cfg: PantauConfig): void {
  config = {
    ...cfg,
    baseUrl: cfg.baseUrl || 'http://localhost:3001',
  };
}

/**
 * Express middleware — auto-detect routes & track performance.
 * Usage: app.use(pantau.middleware())
 */
export function middleware() {
  return (req: IncomingMessage, res: ServerResponse, next: (err?: any) => void) => {
    if (!config) {
      return next();
    }

    const start = Date.now();
    const method = req.method || 'GET';
    const url = req.url || '/';
    // Strip query string for route grouping
    const path = url.split('?')[0];

    // Capture original end to measure response
    const originalEnd = res.end.bind(res);
    res.end = function (this: ServerResponse, ...args: any[]) {
      const responseTimeMs = Date.now() - start;
      const statusCode = res.statusCode || 200;
      const key = `${method}:${path}`;

      // Track stats
      const stats = endpointStats.get(key) || { count: 0, totalTime: 0, errors: 0 };
      stats.count++;
      stats.totalTime += responseTimeMs;
      if (statusCode >= 400) {
        stats.errors++;
      }
      endpointStats.set(key, stats);

      return originalEnd(...args);
    } as typeof res.end;

    next();
  };
}

/**
 * Collect current stats and return a snapshot.
 * Called by heartbeat sender.
 */
function collectStats(): EndpointInfo[] {
  const endpoints: EndpointInfo[] = [];
  endpointStats.forEach((stats, key) => {
    const [method, path] = key.split(':', 2);
    // Recent heartbeat: use average response time
    endpoints.push({
      method,
      path,
      statusCode: stats.errors === 0 ? 200 : 500,
      responseTimeMs: stats.count > 0 ? Math.round(stats.totalTime / stats.count) : 0,
    });
  });
  return endpoints;
}

/**
 * Send heartbeat to Pantau API.
 */
async function sendHeartbeat(): Promise<void> {
  if (!config) return;

  const endpoints = collectStats();
  if (endpoints.length === 0) return;

  const payload = {
    service: config.serviceName,
    endpoints,
  };

  try {
    const res = await fetch(`${config.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[pantau] Heartbeat failed: ${res.status}`);
    }
  } catch (err: any) {
    // Silent failure — don't crash user's app
    console.error(`[pantau] Heartbeat error: ${err.message}`);
  }
}

/**
 * Start periodic heartbeat. Default every 30 seconds.
 */
export function startHeartbeat(intervalMs: number = 30_000): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  // Send immediately, then periodically
  sendHeartbeat();
  heartbeatInterval = setInterval(sendHeartbeat, intervalMs);
}

/**
 * Stop heartbeat interval.
 */
export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Shutdown — send final heartbeat and clean up.
 */
export async function shutdown(): Promise<void> {
  stopHeartbeat();
  await sendHeartbeat();
}
