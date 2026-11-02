import { config } from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server';

config();

async function main() {
    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
