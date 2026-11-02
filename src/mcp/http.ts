import { Router, json, type Request, type Response, type NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'crypto';
import { createMcpServer } from './server';

const router = Router();

function safeEqual(a: string, b: string) {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Protects the endpoint with MCP_SECRET.
 * Accepted as path segment (/mcp/<secret>), ?key=<secret> or "Authorization: Bearer <secret>".
 */
function auth(req: Request, res: Response, next: NextFunction) {
    const secret = process.env.MCP_SECRET;

    if (!secret) {
        res.status(500).json({ error: 'MCP_SECRET ist nicht gesetzt' });
        return;
    }

    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const provided = req.params.secret ?? (req.query.key as string | undefined) ?? bearer;

    if (!provided || !safeEqual(provided, secret)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }

    next();
}

// Stateless mode: every request gets its own server + transport.
async function handle(req: Request, res: Response) {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
    });

    res.on('close', () => {
        transport.close();
        server.close();
    });

    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error('MCP error', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null
            });
        }
    }
}

function methodNotAllowed(_req: Request, res: Response) {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
    });
}

for (const path of ['/', '/:secret']) {
    router.post(path, json(), auth, handle);
    router.get(path, auth, methodNotAllowed);
    router.delete(path, auth, methodNotAllowed);
}

export default router;
