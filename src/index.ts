import { config } from 'dotenv';
import express from 'express';
import router from './routes';
import mcpRouter from './mcp/http';

if (process.env.NODE_ENV !== 'production') {
    config();
}

const app = express();

app.use('/api/sync', router);
app.use('/mcp', mcpRouter);

const port = process.env.PORT || 3333;

app.use(
    process.env.RAILWAY_VOLUME_MOUNT_PATH ?? './out/',
    express.static('public')
);

// On Vercel the exported app is run as a serverless function; locally / on Railway we listen ourselves.
if (!process.env.VERCEL) {
    app.listen(port, () =>
        console.log(`API available on http://localhost:${port}`)
    );
}

export default app;
