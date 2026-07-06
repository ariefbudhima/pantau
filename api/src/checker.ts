/**
 * Heartbeat Checker — long-running monitor loop.
 *
 * - Manual endpoints (type='manual'): pinged directly at their URL.
 * - Auto endpoints (type='auto'): report themselves via the SDK
 *   (/api/ingest); here we only mark them down when heartbeats stop
 *   arriving (lastCheckedAt older than STALE_THRESHOLD_MS). Recovery
 *   happens automatically when heartbeats resume.
 *
 * Run continuously: npx tsx src/checker.ts
 * Run one cycle:    npx tsx src/checker.ts --once
 */
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { db, pool } from './db';
import { endpoints, heartbeats } from './schema';
import { sendAlert } from './alert';
import https from 'https';
import http from 'http';

const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '30000');
const STALE_THRESHOLD_MS = parseInt(process.env.STALE_THRESHOLD_MS || '90000');

function ping(url: string): Promise<{ statusCode: number; responseTimeMs: number; error?: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = url.startsWith('https') ? https : http;

    const req = client.get(url, { timeout: 10_000 }, (res) => {
      const responseTimeMs = Date.now() - start;
      // Consume response to free memory
      res.resume();
      res.on('end', () => {
        resolve({ statusCode: res.statusCode || 0, responseTimeMs });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, responseTimeMs: Date.now() - start, error: 'timeout' });
    });

    req.on('error', (err: NodeJS.ErrnoException & { errors?: Error[] }) => {
      // AggregateError (e.g. ECONNREFUSED on both IPv6 and IPv4) has an
      // empty .message — the real reasons live in .errors
      const message =
        err.message || err.errors?.map((e) => e.message).join('; ') || err.code || 'connection error';
      resolve({ statusCode: 0, responseTimeMs: Date.now() - start, error: message });
    });
  });
}

type ManualEndpoint = { id: number; method: string; path: string; url: string | null; status: string | null };

async function checkManualEndpoint(ep: ManualEndpoint, now: Date): Promise<void> {
  const pingResult = await ping(ep.url!);
  const newStatus = pingResult.statusCode >= 200 && pingResult.statusCode < 400 ? 'up' : 'down';

  await db.update(endpoints)
    .set({ status: newStatus, lastCheckedAt: now })
    .where(eq(endpoints.id, ep.id));

  await db.insert(heartbeats).values({
    endpointId: ep.id, statusCode: pingResult.statusCode,
    responseTimeMs: pingResult.responseTimeMs, status: newStatus,
    errorMessage: pingResult.error || null, checkedAt: now,
  });

  if (newStatus !== ep.status) {
    console.log(`[checker] ${ep.method} ${ep.url} — ${ep.status} → ${newStatus} (${pingResult.responseTimeMs}ms)`);
    sendAlert({
      endpointId: ep.id,
      endpointName: ep.path, method: ep.method, path: ep.path, url: ep.url,
      oldStatus: ep.status, newStatus, responseTimeMs: pingResult.responseTimeMs,
      errorMessage: pingResult.error || null, timestamp: now,
    });
  }
}

async function checkManualEndpoints(now: Date): Promise<number> {
  const rows = await db
    .select({
      id: endpoints.id, method: endpoints.method, path: endpoints.path,
      url: endpoints.url, status: endpoints.status,
    })
    .from(endpoints)
    .where(and(eq(endpoints.type, 'manual'), isNotNull(endpoints.url)));

  await Promise.allSettled(rows.map((ep) => checkManualEndpoint(ep, now)));
  return rows.length;
}

async function markStaleAutoEndpoints(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_THRESHOLD_MS);

  const stale = await db.update(endpoints)
    .set({ status: 'down' })
    .where(and(
      eq(endpoints.type, 'auto'),
      eq(endpoints.status, 'up'),
      lt(endpoints.lastCheckedAt, cutoff),
    ))
    .returning({
      id: endpoints.id, method: endpoints.method,
      path: endpoints.path, lastCheckedAt: endpoints.lastCheckedAt,
    });

  for (const ep of stale) {
    await db.insert(heartbeats).values({
      endpointId: ep.id, statusCode: 0, responseTimeMs: 0, status: 'down',
      errorMessage: `no heartbeat received for ${Math.round(STALE_THRESHOLD_MS / 1000)}s`,
      checkedAt: now,
    });
    console.log(`[checker] ${ep.method} ${ep.path} — up → down (heartbeat stale since ${ep.lastCheckedAt?.toISOString()})`);
    sendAlert({
      endpointId: ep.id,
      endpointName: ep.path, method: ep.method, path: ep.path,
      oldStatus: 'up', newStatus: 'down',
      errorMessage: `No heartbeat for ${Math.round(STALE_THRESHOLD_MS / 1000)}s`,
      timestamp: now,
    });
  }

  return stale.length;
}

async function runCycle(): Promise<void> {
  const now = new Date();
  const [manualCount, staleCount] = await Promise.all([
    checkManualEndpoints(now),
    markStaleAutoEndpoints(now),
  ]);
  console.log(`[checker] Cycle done — ${manualCount} manual pinged, ${staleCount} auto marked down`);
}

async function loop(): Promise<void> {
  try {
    await runCycle();
  } catch (err) {
    console.error('[checker] Error:', err); // keep looping — one bad round shouldn't kill the checker
  }
  setTimeout(loop, CHECK_INTERVAL_MS);
}

if (process.argv.includes('--once')) {
  runCycle()
    .then(() => pool.end())
    .catch((err) => {
      console.error('[checker] Error:', err);
      process.exit(1);
    });
} else {
  console.log(`[checker] Started — interval ${CHECK_INTERVAL_MS}ms, stale threshold ${STALE_THRESHOLD_MS}ms`);
  loop();
}
