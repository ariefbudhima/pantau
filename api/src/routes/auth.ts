import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { users } from '../schema';
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

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = generateApiKey();

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name: name || null, apiKey })
      .returning({
        id: users.id, email: users.email, name: users.name,
        api_key: users.apiKey, tier: users.tier, created_at: users.createdAt,
      });
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

    const [user] = await db
      .select({
        id: users.id, email: users.email, password_hash: users.passwordHash,
        name: users.name, api_key: users.apiKey, tier: users.tier,
      })
      .from(users)
      .where(eq(users.email, email));

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
    const [user] = await db
      .select({
        id: users.id, email: users.email, name: users.name,
        api_key: users.apiKey, tier: users.tier, created_at: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.userId!));

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({ user });
  } catch (err: any) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
