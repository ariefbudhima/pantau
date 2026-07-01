"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
function generateApiKey() {
    return 'pk_' + crypto_1.default.randomBytes(24).toString('hex');
}
// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        const existing = await db_1.pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const passwordHash = await bcryptjs_1.default.hash(password, 12);
        const apiKey = generateApiKey();
        const result = await db_1.pool.query(`INSERT INTO users (email, password_hash, name, api_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, api_key, tier, created_at`, [email, passwordHash, name || null, apiKey]);
        const user = result.rows[0];
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, (0, auth_1.getJWTSecret)(), { expiresIn: '7d' });
        return res.status(201).json({ user, token });
    }
    catch (err) {
        console.error('Register error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        const result = await db_1.pool.query('SELECT id, email, password_hash, name, api_key, tier FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id }, (0, auth_1.getJWTSecret)(), { expiresIn: '7d' });
        const { password_hash, ...safeUser } = user;
        return res.json({ user: safeUser, token });
    }
    catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
// GET /api/auth/me
router.get('/me', auth_1.authMiddleware, async (req, res) => {
    try {
        const result = await db_1.pool.query('SELECT id, email, name, api_key, tier, created_at FROM users WHERE id = $1', [req.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ user: result.rows[0] });
    }
    catch (err) {
        console.error('Me error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map