import { Router, Response } from 'express';
import { createHmac } from 'crypto';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

/** Same keyed hash the SDK uses, so a plaintext PII term can be matched to
 *  stored hashes. HMAC key = the user's api_key. */
function hashValue(value: string, secret: string): string {
  return '#' + createHmac('sha256', secret).update(value.trim().toLowerCase()).digest('hex').slice(0, 16);
}

// GET /api/logs/hash?value=budi@gmail.com — returns the searchable hash for a
// PII term, computed with the caller's api_key. Dashboard uses this to search
// hashed fields without ever knowing the HMAC secret.
router.get('/hash', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const value = (req.query.value as string) || '';
    if (!value) return res.status(400).json({ error: 'value required' });
    const r = await pool.query('SELECT api_key FROM users WHERE id = $1', [req.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'user not found' });
    return res.json({ hash: hashValue(value, r.rows[0].api_key) });
  } catch (err: any) {
    console.error('Hash error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** Build shared WHERE clause + params from query filters. */
function buildFilter(req: AuthRequest) {
  const { endpointId, status, q, since, method } = req.query as Record<string, string>;
  const conds: string[] = ['p.user_id = $1'];
  const params: any[] = [req.userId];

  if (endpointId) { params.push(endpointId); conds.push(`l.endpoint_id = $${params.length}`); }
  if (method) { params.push(method); conds.push(`l.method = $${params.length}`); }
  // Path-only search (fast, uses index).
  if (q) { params.push(`%${q}%`); conds.push(`l.path ILIKE $${params.length}`); }
  // Body search: match a term anywhere in request/response JSON. Used for
  // searchable PII — pass the hashed term (bodyHash) to find "did user X hit
  // this route" without the raw value ever being stored.
  const bodyq = (req.query.bodyq as string) || '';
  if (bodyq) {
    params.push(`%${bodyq}%`);
    const i = params.length;
    conds.push(`(l.request_body::text ILIKE $${i} OR l.response_body::text ILIKE $${i})`);
  }
  if (since) { params.push(since); conds.push(`l.logged_at >= $${params.length}`); }
  if (status === '2xx') conds.push('l.status_code >= 200 AND l.status_code < 300');
  else if (status === '4xx') conds.push('l.status_code >= 400 AND l.status_code < 500');
  else if (status === '5xx') conds.push('l.status_code >= 500');

  return { where: conds.join(' AND '), params };
}

// GET /api/logs — search request logs (most recent, paged).
// Query: endpointId, status (2xx|4xx|5xx), q (path substring), since (ISO), limit (max 500).
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { where, params } = buildFilter(req);
    const limit = Math.min(parseInt((req.query.limit as string) || '100'), 500);
    params.push(limit);

    const result = await pool.query(
      `SELECT l.id, l.method, l.path, l.status_code, l.response_time_ms,
              l.error_message, l.request_body, l.response_body, l.headers,
              l.logged_at, e.name AS endpoint_name
       FROM request_logs l
       JOIN projects p ON l.project_id = p.id
       LEFT JOIN endpoints e ON l.endpoint_id = e.id
       WHERE ${where}
       ORDER BY l.logged_at DESC
       LIMIT $${params.length}`,
      params
    );
    return res.json({ logs: result.rows });
  } catch (err: any) {
    console.error('Logs query error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/logs/stats — aggregates + time histogram over the FULL window
// (not capped at 500), so charts/counts reflect the whole timeframe.
router.get('/stats', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { where, params } = buildFilter(req);
    const buckets = Math.min(parseInt((req.query.buckets as string) || '40'), 200);

    // Aggregates: total, error rate, avg + p95 latency, time span.
    const agg = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE l.status_code >= 400)::int AS errors,
              COALESCE(ROUND(AVG(l.response_time_ms)))::int AS avg_ms,
              COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY l.response_time_ms)))::int AS p95_ms,
              MIN(l.logged_at) AS min_t, MAX(l.logged_at) AS max_t
       FROM request_logs l
       JOIN projects p ON l.project_id = p.id
       WHERE ${where}`,
      params
    );
    const a = agg.rows[0];

    let histogram: any[] = [];
    if (a.total > 0 && a.min_t && a.max_t) {
      // width_bucket over the epoch range, split by status class.
      const bp = [...params, buckets];
      const hist = await pool.query(
        `WITH bounds AS (
           SELECT EXTRACT(EPOCH FROM MIN(l.logged_at)) AS lo,
                  EXTRACT(EPOCH FROM MAX(l.logged_at)) + 0.001 AS hi
           FROM request_logs l JOIN projects p ON l.project_id = p.id WHERE ${where}
         )
         SELECT width_bucket(EXTRACT(EPOCH FROM l.logged_at), b.lo, b.hi, $${bp.length}) AS bucket,
                to_timestamp(b.lo + (b.hi - b.lo) * (width_bucket(EXTRACT(EPOCH FROM l.logged_at), b.lo, b.hi, $${bp.length}) - 1) / $${bp.length}) AS t,
                COUNT(*) FILTER (WHERE l.status_code >= 200 AND l.status_code < 400)::int AS ok,
                COUNT(*) FILTER (WHERE l.status_code >= 400 AND l.status_code < 500)::int AS warn,
                COUNT(*) FILTER (WHERE l.status_code >= 500)::int AS err
         FROM request_logs l
         JOIN projects p ON l.project_id = p.id
         CROSS JOIN bounds b
         WHERE ${where}
         GROUP BY bucket, b.lo, b.hi
         ORDER BY bucket`,
        bp
      );
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
