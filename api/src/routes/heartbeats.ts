import { Router, Response } from 'express';
import { pool } from '../db';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/heartbeats/:endpointId — get recent heartbeats
router.get('/:endpointId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { endpointId } = req.params;

    // Verify ownership
    const epCheck = await pool.query(
      `SELECT e.id FROM endpoints e
       JOIN projects p ON e.project_id = p.id
       WHERE e.id = $1 AND p.user_id = $2`,
      [endpointId, req.userId]
    );

    if (epCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    const result = await pool.query(
      `SELECT id, status_code, response_time_ms, status, error_message, checked_at
       FROM heartbeats
       WHERE endpoint_id = $1
       ORDER BY checked_at DESC
       LIMIT 100`,
      [endpointId]
    );

    // Compute uptime
    const total = result.rows.length;
    const up = result.rows.filter((h: any) => h.status === 'up').length;
    const uptimePct = total > 0 ? ((up / total) * 100).toFixed(2) : '0';

    return res.json({
      endpointId,
      heartbeats: result.rows,
      stats: {
        total,
        up,
        down: total - up,
        uptime_pct: parseFloat(uptimePct),
      },
    });
  } catch (err: any) {
    console.error('Heartbeats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
