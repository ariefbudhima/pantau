"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.getJWTSecret = getJWTSecret;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'pantau-dev-secret-change-in-prod';
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header) {
        return res.status(401).json({ error: 'No authorization header' });
    }
    if (header.startsWith('Bearer ')) {
        const token = header.slice(7);
        try {
            const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            req.userId = payload.userId;
            return next();
        }
        catch {
            return res.status(401).json({ error: 'Invalid token' });
        }
    }
    if (header.startsWith('ApiKey ')) {
        req.apiKey = header.slice(7);
        return next();
    }
    return res.status(401).json({ error: 'Invalid authorization format' });
}
function getJWTSecret() {
    return JWT_SECRET;
}
//# sourceMappingURL=auth.js.map