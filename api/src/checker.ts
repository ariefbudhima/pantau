/**
 * Heartbeat Checker — pings manual URL monitors on an interval.
 * Auto-detected endpoints report themselves via the SDK (/api/ingest),
 * so we only ping type='manual' rows here.
 * Run: npx tsx src/checker.ts  (long-running; loops every CHECK_INTERVAL_MS)
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from './db';
import { endpoints, heartbeats } from './schema';
import https from 'https';
import http from 'http';

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

    req.on('error', (err) => {
      resolve({ statusCode: 0, responseTimeMs: Date.now() - start, error: err.message });
    });
  });
}

async function checkAll(): Promise<void> {
  console.log(`[checker] Starting heartbeat check at ${new Date().toISOString()}`);

  const rows = await db
    .select({
      id: endpoints.id, method: endpoints.method, path: endpoints.path,
      url: endpoints.url, status: endpoints.status,
    })
    .from(endpoints)
    .where(and(eq(endpoints.type, 'manual'), isNotNull(endpoints.url)));

  if (rows.length === 0) {
    console.log('[checker] No endpoints to check');
    return;
  }

  const now = new Date();
  let checked = 0;

  for (const ep of rows) {
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

    checked++;
    if (newStatus !== ep.status) {
      console.log(`[checker] ${ep.method} ${ep.path} — ${ep.status} → ${newStatus} (${pingResult.responseTimeMs}ms)`);
    }
  }

  console.log(`[checker] Done. Checked ${checked} endpoints.`);
}

const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MS || '60000');

async function loop(): Promise<void> {
  try {
    await checkAll();
  } catch (err) {
    console.error('[checker] Error:', err); // keep looping — one bad round shouldn't kill the checker
  }
  setTimeout(loop, CHECK_INTERVAL_MS);
}

loop();
