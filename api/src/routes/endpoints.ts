import { Router, Response } from 'express';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { db, TIER_LIMITS, countUserEndpoints } from '../db';
import { users, projects, endpoints } from '../schema';
import { AuthRequest, authMiddleware } from '../middleware/auth';

const router = Router();

// GET /api/endpoints — list all endpoints for user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({
        id: endpoints.id, name: endpoints.name, method: endpoints.method,
        path: endpoints.path, type: endpoints.type, url: endpoints.url,
        status: endpoints.status, last_checked_at: endpoints.lastCheckedAt,
        created_at: endpoints.createdAt,
        project_name: projects.name, project_slug: projects.slug,
      })
      .from(endpoints)
      .innerJoin(projects, eq(endpoints.projectId, projects.id))
      .where(eq(projects.userId, req.userId!))
      .orderBy(desc(endpoints.createdAt));

    return res.json({ endpoints: rows });
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
    const [u] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, req.userId!));
    const tier = u?.tier || 'free';
    const limit = TIER_LIMITS[tier] ?? null;
    if (limit !== null && (await countUserEndpoints(req.userId!)) >= limit) {
      return res.status(403).json({ error: `Tier '${tier}' limit reached (${limit} endpoints). Upgrade to add more.` });
    }

    // Get or create project
    let [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.userId, req.userId!), eq(projects.slug, projectSlug)));

    if (!project) {
      [project] = await db
        .insert(projects)
        .values({ userId: req.userId!, name: projectSlug, slug: projectSlug })
        .returning({ id: projects.id });
    }

    const [endpoint] = await db
      .insert(endpoints)
      .values({
        projectId: project.id, name: name || url, method: method || 'GET',
        path: url, type: 'manual', url, status: 'unknown',
      })
      .returning({
        id: endpoints.id, name: endpoints.name, method: endpoints.method,
        path: endpoints.path, type: endpoints.type, url: endpoints.url,
        status: endpoints.status, created_at: endpoints.createdAt,
      });

    return res.status(201).json({ endpoint });
  } catch (err: any) {
    console.error('Add endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/endpoints/:id
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Only delete endpoints under a project the user owns.
    const owned = db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, req.userId!));

    const deleted = await db
      .delete(endpoints)
      .where(and(eq(endpoints.id, Number(req.params.id)), inArray(endpoints.projectId, owned)))
      .returning({ id: endpoints.id });

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Endpoint not found' });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Delete endpoint error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
