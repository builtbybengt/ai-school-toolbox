import { config } from 'dotenv';
import express from 'express';
import router from './routes';

if (process.env.NODE_ENV !== 'production') {
    config();
}

const app = express();

app.use('/api/sync', router);

const port = process.env.PORT || 3333;

app.use(
    process.env.RAILWAY_VOLUME_MOUNT_PATH ?? './out/',
    express.static('public')
);

app.listen(port, () =>
    console.log(`API available on http://localhost:${port}`)
);
