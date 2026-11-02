import { Router, json, type Request, type Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireSecret as auth } from '../lib/auth';
import { createMcpServer } from './server';

const router = Router();

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
    // Auth first, then parse. 4 MB: base64 file uploads (Vercel caps requests at 4.5 MB).
    router.post(path, auth, json({ limit: '4mb' }), handle);
    router.get(path, auth, methodNotAllowed);
    router.delete(path, auth, methodNotAllowed);
}

export default router;
