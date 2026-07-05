import { Router, Response } from 'express';
import { createHmac } from 'crypto';
import { sql, and, eq, desc, gte, ilike, or, type SQL } from 'drizzle-orm';
import { db } from '../db';
import { users, projects, endpoints, requestLogs as rl } from '../schema';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

/** Same keyed hash the SDK uses, so a plaintext PII term can be matched to
 *  stored hashes. HMAC key = the user's api_key. */
function hashValue(value: string, secret: string): string {
  return '#' + createHmac('sha256', secret).update(value.trim().toLowerCase()).digest('hex').slice(0, 16);
}

// GET /api/logs/hash?value=budi@gmail.com — returns the searchable hash for a
// PII term, computed with the caller's api_key.
router.get('/hash', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const value = (req.query.value as string) || '';
    if (!value) return res.status(400).json({ error: 'value required' });
    const [u] = await db.select({ apiKey: users.apiKey }).from(users).where(eq(users.id, req.userId!));
    if (!u) return res.status(404).json({ error: 'user not found' });
    return res.json({ hash: hashValue(value, u.apiKey) });
  } catch (err: any) {
    console.error('Hash error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Build the shared WHERE conditions from query filters (typed, composable). */
function buildConds(req: AuthRequest): SQL[] {
  const { endpointId, status, q, since, method, bodyq } = req.query as Record<string, string>;
  const conds: SQL[] = [eq(projects.userId, req.userId!)];

  if (endpointId) conds.push(eq(rl.endpointId, Number(endpointId)));
  if (method) conds.push(eq(rl.method, method));
  if (q) conds.push(ilike(rl.path, `%${q}%`));
  // Body search: match a term (usually a hashed PII value) anywhere in the JSON.
  if (bodyq) {
    conds.push(
      or(
        sql`${rl.requestBody}::text ILIKE ${`%${bodyq}%`}`,
        sql`${rl.responseBody}::text ILIKE ${`%${bodyq}%`}`,
      )!
    );
  }
  if (since) conds.push(gte(rl.loggedAt, new Date(since)));
  if (status === '2xx') conds.push(sql`${rl.statusCode} >= 200 AND ${rl.statusCode} < 300`);
  else if (status === '4xx') conds.push(sql`${rl.statusCode} >= 400 AND ${rl.statusCode} < 500`);
  else if (status === '5xx') conds.push(sql`${rl.statusCode} >= 500`);

  return conds;
}

// GET /api/logs — search request logs (most recent, paged).
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    const rows = await db
      .select({
        id: rl.id, method: rl.method, path: rl.path, status_code: rl.statusCode,
        response_time_ms: rl.responseTimeMs, error_message: rl.errorMessage,
        request_body: rl.requestBody, response_body: rl.responseBody, headers: rl.headers,
        logged_at: rl.loggedAt, endpoint_name: endpoints.name,
      })
      .from(rl)
      .innerJoin(projects, eq(rl.projectId, projects.id))
      .leftJoin(endpoints, eq(rl.endpointId, endpoints.id))
      .where(and(...buildConds(req)))
      .orderBy(desc(rl.loggedAt))
      .limit(limit);

    return res.json({ logs: rows });
  } catch (err: any) {
    console.error('Logs query error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/logs/stats — aggregates + time histogram over the FULL window.
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const buckets = Math.min(parseInt((req.query.buckets as string) || '40'), 200);
    const where = and(...buildConds(req));

    const [a] = await db
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${rl.statusCode} >= 400)::int`,
        avg_ms: sql<number>`coalesce(round(avg(${rl.responseTimeMs})), 0)::int`,
        p95_ms: sql<number>`coalesce(round(percentile_cont(0.95) within group (order by ${rl.responseTimeMs})), 0)::int`,
        min_t: sql<string | null>`min(${rl.loggedAt})`,
        max_t: sql<string | null>`max(${rl.loggedAt})`,
      })
      .from(rl)
      .innerJoin(projects, eq(rl.projectId, projects.id))
      .where(where);

    let histogram: any[] = [];
    if (a.total > 0 && a.min_t && a.max_t) {
      // width_bucket over the epoch range, split by status class. Timescale/pg
      // window math the ORM can't express — kept as raw sql, filters reused.
      const hist = await db.execute<{ t: string; ok: number; warn: number; err: number }>(sql`
        WITH bounds AS (
          SELECT extract(epoch from min(${rl.loggedAt})) AS lo,
                 extract(epoch from max(${rl.loggedAt})) + 0.001 AS hi
          FROM ${rl} INNER JOIN ${projects} ON ${rl.projectId} = ${projects.id}
          WHERE ${where}
        ),
        bucketed AS (
          SELECT width_bucket(extract(epoch from ${rl.loggedAt}), b.lo, b.hi, ${buckets}) AS bucket,
                 b.lo, b.hi, ${rl.statusCode} AS status_code
          FROM ${rl}
          INNER JOIN ${projects} ON ${rl.projectId} = ${projects.id}
          CROSS JOIN bounds b
          WHERE ${where}
        )
        SELECT to_timestamp(lo + (hi - lo) * (bucket - 1) / ${buckets}) AS t,
               count(*) filter (where status_code >= 200 AND status_code < 400)::int AS ok,
               count(*) filter (where status_code >= 400 AND status_code < 500)::int AS warn,
               count(*) filter (where status_code >= 500)::int AS err
        FROM bucketed
        GROUP BY bucket, lo, hi
        ORDER BY bucket
      `);
      histogram = hist.rows.map((r) => ({ t: r.t, ok: r.ok, warn: r.warn, err: r.err }));
    }

    return res.json({
      total: a.total,
      errors: a.errors,
      errorRate: a.total ? +((a.errors / a.total) * 100).toFixed(1) : 0,
      avgMs: a.avg_ms || 0,
      p95Ms: a.p95_ms || 0,
      minT: a.min_t,
      maxT: a.max_t,
      histogram,
    });
  } catch (err: any) {
    console.error('Logs stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
