import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    userId?: number;
    apiKey?: string;
}
export declare function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void | Response<any, Record<string, any>>;
export declare function getJWTSecret(): string;
//# sourceMappingURL=auth.d.ts.map