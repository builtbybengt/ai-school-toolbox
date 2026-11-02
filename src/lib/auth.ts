import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Protects an endpoint with MCP_SECRET.
 * Recommended: "Authorization: Bearer <secret>" header.
 * Fallback for clients that cannot set headers: path segment (/<secret>) or ?key=<secret>.
 */
export function requireSecret(req: Request, res: Response, next: NextFunction) {
    const secret = process.env.MCP_SECRET;

    if (!secret) {
        res.status(500).json({ error: 'MCP_SECRET ist nicht gesetzt' });
        return;
    }

    const header = req.headers.authorization;
    const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    const provided =
        bearer ?? req.params.secret ?? (req.query.key as string | undefined);

    if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}
