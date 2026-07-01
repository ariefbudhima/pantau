"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const router = (0, express_1.Router)();
// POST /api/ingest — SDK sends heartbeat data here
router.post('/', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(401).json({ error: 'x-api-key header required' });
        }
        // Find user by API key
        const userResult = await db_1.pool.query('SELECT id FROM users WHERE api_key = $1', [apiKey]);
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
        const projectResult = await db_1.pool.query(`INSERT INTO projects (user_id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT(user_id, slug) DO UPDATE SET name = $2
       RETURNING id`, [userId, service, slug]);
        const projectId = projectResult.rows[0].id;
        // Upsert endpoints with proper ON CONFLICT
        const now = new Date().toISOString();
        const upserted = [];
        for (const ep of endpoints) {
            const { method, path, statusCode, responseTimeMs, errorMessage } = ep;
            if (!method || !path)
                continue;
            const newStatus = (statusCode >= 200 && statusCode < 400) ? 'up' : 'down';
            const name = `${method} ${path}`;
            // Single upsert — INSERT or UPDATE on conflict
            const epResult = await db_1.pool.query(`INSERT INTO endpoints (project_id, name, method, path, type, status, last_checked_at)
         VALUES ($1, $2, $3, $4, 'auto', $5, $6)
         ON CONFLICT (project_id, method, path)
         DO UPDATE SET name = $2, status = $5, last_checked_at = $6
         RETURNING id`, [projectId, name, method, path, newStatus, now]);
            const endpointId = epResult.rows[0].id;
            // Record heartbeat
            await db_1.pool.query(`INSERT INTO heartbeats (endpoint_id, status_code, response_time_ms, status, error_message, checked_at)
         VALUES ($1, $2, $3, $4, $5, $6)`, [endpointId, statusCode, responseTimeMs || 0, newStatus, errorMessage || null, now]);
            upserted.push({ method, path, status: newStatus });
        }
        return res.json({ ok: true, endpoints: upserted });
    }
    catch (err) {
        console.error('Ingest error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=ingest.js.map