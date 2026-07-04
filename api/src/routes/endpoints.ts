import { Router, Response } from 'express';
import { pool, TIER_LIMITS, countUserEndpoints } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/endpoints — list all endpoints for user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT e.id, e.name, e.method, e.path, e.type, e.url,
              e.status, e.last_checked_at, e.created_at,
              p.name as project_name, p.slug as project_slug
       FROM endpoints e
       JOIN projects p ON e.project_id = p.id
       WHERE p.user_id = $1
       ORDER BY e.created_at DESC`,
      [req.userId]
    );

    return res.json({ endpoints: result.rows });
  } catch (err: any) {
    console.error('List endpoints error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/endpoints — add manual endpoint
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { projectSlug, name, url, method } = req.body;

    if (!projectSlug || !url) {
      return res.status(400).json({ error: 'projectSlug and url required' });
    }

    // Enforce tier endpoint quota (PRD §6)
    const tierRow = await pool.query('SELECT tier FROM users WHERE id = $1', [req.userId]);
    const tier = tierRow.rows[0]?.tier || 'free';
    const limit = TIER_LIMITS[tier] ?? null;
    if (limit !== null && (await countUserEndpoints(req.userId!)) >= limit) {
      return res.status(403).json({ error: `Tier '${tier}' limit reached (${limit} endpoints). Upgrade to add more.` });
    }

    // Get or create project
    let projectResult = await pool.query(
      'SELECT id FROM projects WHERE user_id = $1 AND slug = $2',
      [req.userId, projectSlug]
    );

    let projectId: number;
    if (projectResult.rows.length === 0) {
      const newProject = await pool.query(
        `INSERT INTO projects (user_id, name, slug)
         VALUES ($1, $2, $3) RETURNING id`,
        [req.userId, projectSlug, projectSlug]
      );
      projectId = newProject.rows[0].id;
    } else {
      projectId = projectResult.rows[0].id;
    }

    const epResult = await pool.query(
      `INSERT INTO endpoints (project_id, name, method, path, type, url, status)
       VALUES ($1, $2, $3, $4, 'manual', $5, 'unknown')
       RETURNING id, name, method, path, type, url, status, created_at`,
      [projectId, name || url, method || 'GET', url, url]
    );

    return res.status(201).json({ endpoint: epResult.rows[0] });
  } catch (err: any) {
    console.error('Add endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/endpoints/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `DELETE FROM endpoints
       WHERE id = $1 AND project_id IN (
         SELECT id FROM projects WHERE user_id = $2
       )
       RETURNING id`,
      [req.params.id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Delete endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
