import { IncomingMessage, ServerResponse } from 'http';
import { redactBody, redactHeaders } from './redact';

interface CaptureConfig {
  body?: boolean;       // capture request+response bodies (opt-in, default false)
  headers?: boolean;    // capture headers (opt-in, default false)
  denyKeys?: string[];    // body keys to fully mask (secrets). Overrides defaults.
  hashKeys?: string[];    // body keys to hash (searchable PII). Overrides defaults.
  partialKeys?: string[]; // body keys to partially show (b***@gmail.com). Opt-in.
  maxBodyBytes?: number;  // truncate captured bodies past this (default 8 KiB)
}

interface PantauConfig {
  apiKey: string;
  baseUrl?: string;
  serviceName: string;
  capture?: CaptureConfig;
}

interface RequestEvent {
  method: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  errorMessage?: string;
  timestamp: string; // ISO — when the request completed
  requestBody?: unknown;   // redacted, only if capture.body
  responseBody?: unknown;  // redacted, only if capture.body
  headers?: Record<string, unknown>; // redacted, only if capture.headers
}

const MAX_BUFFER = 1000; // drop oldest past this so a flush outage can't OOM the app
const DEFAULT_MAX_BODY = 8 * 1024;

let config: PantauConfig | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
// Per-request event buffer (ELK-style). Flushed as a batch by the heartbeat.
let buffer: RequestEvent[] = [];

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
  return (req: any, res: any, next: (err?: any) => void) => {
    if (!config) {
      return next();
    }

    const cap = config.capture || {};
    const redactOpts = {
      denyKeys: cap.denyKeys,
      hashKeys: cap.hashKeys,
      partialKeys: cap.partialKeys,
      hashSecret: config.apiKey, // account-scoped HMAC key → hash not reversible without it
    };
    const maxBytes = cap.maxBodyBytes ?? DEFAULT_MAX_BODY;

    const start = Date.now();
    const method = req.method || 'GET';
    const url = req.url || '/';
    // Strip query string, then collapse dynamic segments (ids, uuids) so
    // /products/1 and /products/2 group as one route: /products/:id.
    const path = normalizePath(url.split('?')[0]);

    // If capturing response bodies, intercept res.json / res.send.
    let responseBody: unknown;
    if (cap.body) {
      const origJson = res.json?.bind(res);
      const origSend = res.send?.bind(res);
      if (origJson) {
        res.json = (payload: unknown) => { responseBody = payload; return origJson(payload); };
      }
      if (origSend) {
        res.send = (payload: unknown) => {
          if (responseBody === undefined) responseBody = payload;
          return origSend(payload);
        };
      }
    }

    // Capture original end to measure response
    const originalEnd = res.end.bind(res);
    res.end = function (this: ServerResponse, ...args: any[]) {
      const responseTimeMs = Date.now() - start;
      const statusCode = res.statusCode || 200;

      const ev: RequestEvent = {
        method,
        path,
        statusCode,
        responseTimeMs,
        errorMessage: statusCode >= 400 ? `HTTP ${statusCode}` : undefined,
        timestamp: new Date().toISOString(),
      };

      // All PII redaction happens HERE, in-process, before the event is
      // buffered — Pantau's servers never receive raw bodies/headers.
      if (cap.body) {
        if (req.body !== undefined) ev.requestBody = clip(redactBody(req.body, redactOpts), maxBytes);
        if (responseBody !== undefined) ev.responseBody = clip(redactBody(responseBody, redactOpts), maxBytes);
      }
      if (cap.headers && req.headers) {
        ev.headers = redactHeaders(req.headers as Record<string, unknown>);
      }

      buffer.push(ev);
      // Bound memory: if flushes are failing, keep the most recent events.
      if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);

      return originalEnd(...args);
    } as typeof res.end;

    next();
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24_RE = /^[0-9a-f]{24}$/i; // mongo ObjectId
const LONGHEX_RE = /^[0-9a-f]{16,}$/i;

/** Replace dynamic path segments (numeric ids, uuids, hashes) with :id. */
export function normalizePath(path: string): string {
  return (
    '/' +
    path
      .split('/')
      .filter(Boolean)
      .map((seg) =>
        /^\d+$/.test(seg) || UUID_RE.test(seg) || HEX24_RE.test(seg) || LONGHEX_RE.test(seg)
          ? ':id'
          : seg
      )
      .join('/')
  );
}

/** Truncate an already-redacted value if its JSON exceeds maxBytes. */
function clip(value: unknown, maxBytes: number): unknown {
  try {
    const json = JSON.stringify(value);
    if (json.length <= maxBytes) return value;
    return { _truncated: true, _bytes: json.length, preview: json.slice(0, maxBytes) };
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Flush buffered request events to Pantau API as a batch.
 * On failure, events are put back so the next flush retries them.
 */
async function sendHeartbeat(): Promise<void> {
  if (!config || buffer.length === 0) return;

  const batch = buffer;
  buffer = [];

  try {
    const res = await fetch(`${config.baseUrl}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
      },
      body: JSON.stringify({ service: config.serviceName, events: batch }),
    });

    if (!res.ok) {
      console.error(`[pantau] Flush failed: ${res.status}`);
      buffer = batch.concat(buffer).slice(-MAX_BUFFER); // requeue for retry
    }
  } catch (err: any) {
    // Silent failure — don't crash user's app. Requeue for next flush.
    console.error(`[pantau] Flush error: ${err.message}`);
    buffer = batch.concat(buffer).slice(-MAX_BUFFER);
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

// Default export so both `import pantau from 'pantau-js'` and
// `import * as pantau from 'pantau-js'` work.
export default { init, middleware, startHeartbeat, stopHeartbeat, shutdown };
