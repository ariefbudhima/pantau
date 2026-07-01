import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'pantau-dev-secret-change-in-prod';

export interface AuthRequest extends Request {
  userId?: number;
  apiKey?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  if (header.startsWith('Bearer ')) {
    const token = header.slice(7);
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
      req.userId = payload.userId;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid token' });
    }
  }

  if (header.startsWith('ApiKey ')) {
    req.apiKey = header.slice(7);
    return next();
  }

  return res.status(401).json({ error: 'Invalid authorization format' });
}

export function getJWTSecret(): string {
  return JWT_SECRET;
}
