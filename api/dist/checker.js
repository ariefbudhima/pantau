"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Heartbeat Checker — cron job that pings all registered endpoints.
 * Run: npx tsx src/checker.ts
 */
const db_1 = require("./db");
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
function ping(url) {
    return new Promise((resolve) => {
        const start = Date.now();
        const client = url.startsWith('https') ? https_1.default : http_1.default;
        const req = client.get(url, { timeout: 10_000 }, (res) => {
            const responseTimeMs = Date.now() - start;
            // Consume response to free memory
            res.resume();
            res.on('end', () => {
                resolve({ statusCode: res.statusCode || 0, responseTimeMs });
            });
        });
        req.on('timeout', () => {
            req.destroy();
            resolve({ statusCode: 0, responseTimeMs: Date.now() - start, error: 'timeout' });
        });
        req.on('error', (err) => {
            resolve({ statusCode: 0, responseTimeMs: Date.now() - start, error: err.message });
        });
    });
}
async function checkAll() {
    console.log(`[checker] Starting heartbeat check at ${new Date().toISOString()}`);
    const result = await db_1.pool.query(`SELECT e.id, e.method, e.path, e.type, e.url, e.status
     FROM endpoints e
     JOIN projects p ON e.project_id = p.id`);
    const endpoints = result.rows;
    if (endpoints.length === 0) {
        console.log('[checker] No endpoints to check');
        return;
    }
    const now = new Date().toISOString();
    let checked = 0;
    for (const ep of endpoints) {
        const targetUrl = ep.type === 'manual' ? ep.url : `http://localhost${ep.path}`;
        if (!targetUrl)
            continue;
        const pingResult = await ping(targetUrl);
        const newStatus = pingResult.statusCode >= 200 && pingResult.statusCode < 400 ? 'up' : 'down';
        // Update endpoint
        await db_1.pool.query(`UPDATE endpoints SET status = $1, last_checked_at = $2 WHERE id = $3`, [newStatus, now, ep.id]);
        // Record heartbeat
        await db_1.pool.query(`INSERT INTO heartbeats (endpoint_id, status_code, response_time_ms, status, error_message, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`, [ep.id, pingResult.statusCode, pingResult.responseTimeMs, newStatus, pingResult.error || null, now]);
        checked++;
        if (newStatus !== ep.status) {
            console.log(`[checker] ${ep.method} ${ep.path} — ${ep.status} → ${newStatus} (${pingResult.responseTimeMs}ms)`);
        }
    }
    console.log(`[checker] Done. Checked ${checked} endpoints.`);
}
checkAll()
    .then(() => {
    process.exit(0);
})
    .catch((err) => {
    console.error('[checker] Error:', err);
    process.exit(1);
});
//# sourceMappingURL=checker.js.map