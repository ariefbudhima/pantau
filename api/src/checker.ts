/**
 * Heartbeat Checker — pings manual URL monitors on an interval.
 * Auto-detected endpoints report themselves via the SDK (/api/ingest),
 * so we only ping type='manual' rows here.
 * Run: npx tsx src/checker.ts  (long-running; loops every CHECK_INTERVAL_MS)
 */
import { pool } from './db';
import https from 'https';
import http from 'http';

interface Endpoint {
  id: number;
  method: string;
  path: string;
  type: string;
  url: string;
  status: string;
}

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

  const result = await pool.query(
    `SELECT e.id, e.method, e.path, e.type, e.url, e.status
     FROM endpoints e
     JOIN projects p ON e.project_id = p.id
     WHERE e.type = 'manual' AND e.url IS NOT NULL`
  );

  const endpoints: Endpoint[] = result.rows;

  if (endpoints.length === 0) {
    console.log('[checker] No endpoints to check');
    return;
  }

  const now = new Date().toISOString();
  let checked = 0;

  for (const ep of endpoints) {
    const pingResult = await ping(ep.url);
    const newStatus = pingResult.statusCode >= 200 && pingResult.statusCode < 400 ? 'up' : 'down';

    // Update endpoint
    await pool.query(
      `UPDATE endpoints SET status = $1, last_checked_at = $2 WHERE id = $3`,
      [newStatus, now, ep.id]
    );

    // Record heartbeat
    await pool.query(
      `INSERT INTO heartbeats (endpoint_id, status_code, response_time_ms, status, error_message, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ep.id, pingResult.statusCode, pingResult.responseTimeMs, newStatus, pingResult.error || null, now]
    );

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
