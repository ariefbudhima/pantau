import { Router, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { projects, endpoints, heartbeats } from '../schema';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/heartbeats/:endpointId — get recent heartbeats
router.get('/:endpointId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const endpointId = Number(req.params.endpointId);

    // Verify ownership
    const [owned] = await db
      .select({ id: endpoints.id })
      .from(endpoints)
      .innerJoin(projects, eq(endpoints.projectId, projects.id))
      .where(and(eq(endpoints.id, endpointId), eq(projects.userId, req.userId!)));

    if (!owned) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    const rows = await db
      .select({
        id: heartbeats.id, status_code: heartbeats.statusCode,
        response_time_ms: heartbeats.responseTimeMs, status: heartbeats.status,
        error_message: heartbeats.errorMessage, checked_at: heartbeats.checkedAt,
      })
      .from(heartbeats)
      .where(eq(heartbeats.endpointId, endpointId))
      .orderBy(desc(heartbeats.checkedAt))
      .limit(100);

    // Compute uptime
    const total = rows.length;
    const up = rows.filter((h) => h.status === 'up').length;
    const uptimePct = total > 0 ? ((up / total) * 100).toFixed(2) : '0';

    return res.json({
      endpointId,
      heartbeats: rows,
      stats: { total, up, down: total - up, uptime_pct: parseFloat(uptimePct) },
    });
  } catch (err: any) {
    console.error('Heartbeats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
