import { Router, Response } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db, TIER_LIMITS, countUserEndpoints } from '../db';
import { users, projects, endpoints, requestLogs } from '../schema';

const router = Router();

// POST /api/ingest — SDK sends heartbeat data here
router.post('/', async (req, res: Response) => {
  try {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      return res.status(401).json({ error: 'x-api-key header required' });
    }

    // Find user by API key
    const [foundUser] = await db.select({ id: users.id, tier: users.tier })
      .from(users).where(eq(users.apiKey, apiKey));

    if (!foundUser) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const userId = foundUser.id;
    const { service, events } = req.body;

    if (!service || !Array.isArray(events)) {
      return res.status(400).json({ error: 'service name and events array required' });
    }
    if (events.length === 0) return res.json({ ok: true, stored: 0, skipped: 0 });

    // Upsert project
    const slug = service.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const [project] = await db
      .insert(projects)
      .values({ userId, name: service, slug })
      .onConflictDoUpdate({ target: [projects.userId, projects.slug], set: { name: service } })
      .returning({ id: projects.id });
    const projectId = project.id;

    // Tier quota (PRD §6): existing endpoints accept logs freely, but a new
    // (method, path) past the limit is dropped.
    const tier = foundUser.tier || 'free';
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
        const [existing] = await db
          .select({ id: endpoints.id })
          .from(endpoints)
          .where(and(
            eq(endpoints.projectId, projectId),
            eq(endpoints.method, method),
            eq(endpoints.path, path),
          ));
        if (!existing) { skipped++; continue; }
        endpointIds.set(`${method}:${path}`, existing.id);
        await db.update(endpoints)
          .set({ status, lastCheckedAt: new Date(ts) })
          .where(eq(endpoints.id, existing.id));
        continue;
      }

      // Upsert + detect insert-vs-update via xmax (pg internal, not exposed by
      // the ORM) so we can keep the tier counter accurate.
      const { rows: [ep] } = await db.execute<{ id: number; inserted: boolean }>(sql`
        INSERT INTO endpoints (project_id, name, method, path, type, status, last_checked_at)
        VALUES (${projectId}, ${name}, ${method}, ${path}, 'auto', ${status}, ${ts})
        ON CONFLICT (project_id, method, path)
        DO UPDATE SET name = ${name}, status = ${status}, last_checked_at = ${ts}
        RETURNING id, (xmax = 0) AS inserted
      `);
      if (ep.inserted) currentCount++;
      endpointIds.set(`${method}:${path}`, ep.id);
    }

    // Bulk-insert every request event into the log store.
    const logRows = [];
    for (const ev of events) {
      const endpointId = endpointIds.get(`${ev.method}:${ev.path}`);
      if (!endpointId) continue; // endpoint was quota-skipped
      logRows.push({
        endpointId, projectId, method: ev.method, path: ev.path,
        statusCode: ev.statusCode, responseTimeMs: ev.responseTimeMs || 0,
        errorMessage: ev.errorMessage || null,
        requestBody: ev.requestBody ?? null,
        responseBody: ev.responseBody ?? null,
        headers: ev.headers ?? null,
        loggedAt: new Date(ev.timestamp || Date.now()),
      });
    }
    if (logRows.length > 0) await db.insert(requestLogs).values(logRows);
    const stored = logRows.length;

    return res.json({ ok: true, stored, skipped });
  } catch (err: any) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
