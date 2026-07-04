import { Router, Response } from 'express';
import { pool, TIER_LIMITS, countUserEndpoints } from '../db';

const router = Router();

// POST /api/ingest — SDK sends heartbeat data here
router.post('/', async (req, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ error: 'x-api-key header required' });
    }

    // Find user by API key
    const userResult = await pool.query(
      'SELECT id FROM users WHERE api_key = $1',
      [apiKey]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const userId = userResult.rows[0].id;
    const { service, events } = req.body;

    if (!service || !Array.isArray(events)) {
      return res.status(400).json({ error: 'service name and events array required' });
    }
    if (events.length === 0) return res.json({ ok: true, stored: 0, skipped: 0 });

    // Upsert project
    const slug = service.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const projectResult = await pool.query(
      `INSERT INTO projects (user_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT(user_id, slug) DO UPDATE SET name = $2
       RETURNING id`,
      [userId, service, slug]
    );
    const projectId = projectResult.rows[0].id;

    // Tier quota (PRD §6): existing endpoints accept logs freely, but a new
    // (method, path) past the limit is dropped.
    const tierRow = await pool.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const tier = tierRow.rows[0]?.tier || 'free';
    const limit = TIER_LIMITS[tier] ?? null;
    let currentCount = await countUserEndpoints(userId);

    // Reduce the raw event stream to one rollup per (method, path): latest
    // status + a representative timestamp. Keeps the up/down endpoint list live.
    const byEndpoint = new Map<string, { method: string; path: string; last: any }>();
    for (const ev of events) {
      if (!ev?.method || !ev?.path) continue;
      const key = `${ev.method}:${ev.path}`;
      byEndpoint.set(key, { method: ev.method, path: ev.path, last: ev });
    }

    // endpoint_id per key, so each log row links to its endpoint.
    const endpointIds = new Map<string, number>();
    let skipped = 0;

    for (const { method, path, last } of byEndpoint.values()) {
      const status = last.statusCode >= 200 && last.statusCode < 400 ? 'up' : 'down';
      const name = `${method} ${path}`;
      const ts = last.timestamp || new Date().toISOString();

      if (limit !== null && currentCount >= limit) {
        const existing = await pool.query(
          'SELECT id FROM endpoints WHERE project_id = $1 AND method = $2 AND path = $3',
          [projectId, method, path]
        );
        if (existing.rows.length === 0) { skipped++; continue; }
        endpointIds.set(`${method}:${path}`, existing.rows[0].id);
        await pool.query(`UPDATE endpoints SET status = $1, last_checked_at = $2 WHERE id = $3`,
          [status, ts, existing.rows[0].id]);
        continue;
      }

      const epResult = await pool.query(
        `INSERT INTO endpoints (project_id, name, method, path, type, status, last_checked_at)
         VALUES ($1, $2, $3, $4, 'auto', $5, $6)
         ON CONFLICT (project_id, method, path)
         DO UPDATE SET name = $2, status = $5, last_checked_at = $6
         RETURNING id, (xmax = 0) AS inserted`,
        [projectId, name, method, path, status, ts]
      );
      if (epResult.rows[0].inserted) currentCount++;
      endpointIds.set(`${method}:${path}`, epResult.rows[0].id);
    }

    // Bulk-insert every request event into the log store.
    let stored = 0;
    for (const ev of events) {
      const endpointId = endpointIds.get(`${ev.method}:${ev.path}`);
      if (!endpointId) continue; // endpoint was quota-skipped
      await pool.query(
        `INSERT INTO request_logs
           (endpoint_id, project_id, method, path, status_code, response_time_ms,
            error_message, request_body, response_body, headers, logged_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [endpointId, projectId, ev.method, ev.path, ev.statusCode,
         ev.responseTimeMs || 0, ev.errorMessage || null,
         ev.requestBody != null ? JSON.stringify(ev.requestBody) : null,
         ev.responseBody != null ? JSON.stringify(ev.responseBody) : null,
         ev.headers != null ? JSON.stringify(ev.headers) : null,
         ev.timestamp || new Date().toISOString()]
      );
      stored++;
    }

    return res.json({ ok: true, stored, skipped });
  } catch (err: any) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
