"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/endpoints — list all endpoints for user
router.get('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.pool.query(`SELECT e.id, e.name, e.method, e.path, e.type, e.url,
              e.status, e.last_checked_at, e.created_at,
              p.name as project_name, p.slug as project_slug
       FROM endpoints e
       JOIN projects p ON e.project_id = p.id
       WHERE p.user_id = $1
       ORDER BY e.created_at DESC`, [req.userId]);
        return res.json({ endpoints: result.rows });
    }
    catch (err) {
        console.error('List endpoints error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/endpoints — add manual endpoint
router.post('/', auth_1.authMiddleware, async (req, res) => {
    try {
        const { projectSlug, name, url, method } = req.body;
        if (!projectSlug || !url) {
            return res.status(400).json({ error: 'projectSlug and url required' });
        }
        // Get or create project
        let projectResult = await db_1.pool.query('SELECT id FROM projects WHERE user_id = $1 AND slug = $2', [req.userId, projectSlug]);
        let projectId;
        if (projectResult.rows.length === 0) {
            const newProject = await db_1.pool.query(`INSERT INTO projects (user_id, name, slug)
         VALUES ($1, $2, $3) RETURNING id`, [req.userId, projectSlug, projectSlug]);
            projectId = newProject.rows[0].id;
        }
        else {
            projectId = projectResult.rows[0].id;
        }
        const epResult = await db_1.pool.query(`INSERT INTO endpoints (project_id, name, method, path, type, url, status)
       VALUES ($1, $2, $3, $4, 'manual', $5, 'unknown')
       RETURNING id, name, method, path, type, url, status, created_at`, [projectId, name || url, method || 'GET', url, url]);
        return res.status(201).json({ endpoint: epResult.rows[0] });
    }
    catch (err) {
        console.error('Add endpoint error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// DELETE /api/endpoints/:id
router.delete('/:id', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.pool.query(`DELETE FROM endpoints
       WHERE id = $1 AND project_id IN (
         SELECT id FROM projects WHERE user_id = $2
       )
       RETURNING id`, [req.params.id, req.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Endpoint not found' });
        }
        return res.json({ ok: true });
    }
    catch (err) {
        console.error('Delete endpoint error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=endpoints.js.map