import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import crypto from 'crypto';

const router = Router();

// POST /api/ingest — SDK sends heartbeat data here
router.post('/', async (req: AuthRequest, res: Response) => {
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
    const { service, endpoints } = req.body;

    if (!service || !endpoints || !Array.isArray(endpoints)) {
      return res.status(400).json({ error: 'service name and endpoints array required' });
    }

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

    // Upsert endpoints
    const now = new Date().toISOString();
    const upserted: any[] = [];

    for (const ep of endpoints) {
      const { method, path, statusCode, responseTimeMs, errorMessage } = ep;

      if (!method || !path) {
        continue;
      }

      const epResult = await pool.query(
        `INSERT INTO endpoints (project_id, name, method, path, type, status, last_checked_at)
         VALUES ($1, $2, $3, $4, 'auto', $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id, status`,
        [projectId, `${method} ${path}`, method, path,
         statusCode >= 200 && statusCode < 400 ? 'up' : 'down',
         now]
      );

      let endpointId: number;
      let currentStatus: string;

      if (epResult.rows.length > 0) {
        endpointId = epResult.rows[0].id;
        currentStatus = epResult.rows[0].status;
      } else {
        // Already exists — get id
        const existing = await pool.query(
          'SELECT id FROM endpoints WHERE project_id = $1 AND method = $2 AND path = $3',
          [projectId, method, path]
        );
        if (existing.rows.length === 0) continue;
        endpointId = existing.rows[0].id;
        currentStatus = statusCode >= 200 && statusCode < 400 ? 'up' : 'down';
      }

      // Update endpoint status
      const newStatus = statusCode >= 200 && statusCode < 400 ? 'up' : 'down';
      await pool.query(
        `UPDATE endpoints SET status = $1, last_checked_at = $2 WHERE id = $3`,
        [newStatus, now, endpointId]
      );

      // Record heartbeat
      await pool.query(
        `INSERT INTO heartbeats (endpoint_id, status_code, response_time_ms, status, error_message, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [endpointId, statusCode, responseTimeMs || 0, newStatus, errorMessage || null, now]
      );

      upserted.push({ method, path, status: newStatus });
    }

    return res.json({ ok: true, endpoints: upserted });
  } catch (err: any) {
    console.error('Ingest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
