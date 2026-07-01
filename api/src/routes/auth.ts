import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db';
import { AuthRequest, authMiddleware, getJWTSecret } from '../middleware/auth';

const router = Router();

function generateApiKey(): string {
  return 'pk_' + crypto.randomBytes(24).toString('hex');
}

// POST /api/auth/register
router.post('/register', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = generateApiKey();

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, api_key)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, name, api_key, tier, created_at`,
      [email, passwordHash, name || null, apiKey]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, getJWTSecret(), { expiresIn: '7d' });

    return res.status(201).json({ user, token });
  } catch (err: any) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: AuthRequest, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash, name, api_key, tier FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user.id }, getJWTSecret(), { expiresIn: '7d' });

    const { password_hash, ...safeUser } = user;
    return res.json({ user: safeUser, token });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, api_key, tier, created_at FROM users WHERE id = $1',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user: result.rows[0] });
  } catch (err: any) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
