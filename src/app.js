import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { sameOrigin } from './middleware/sameOrigin.js';
import { sessionMiddleware } from './middleware/session.js';
import { healthRouter } from './modules/health/health.routes.js';
import { interactionsRouter } from './modules/interactions/interactions.routes.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/health' },
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);

app.use('/api/discord/interactions', interactionsRouter);
app.use('/api/health', healthRouter);

app.use('/api', express.json({ limit: '100kb' }));
app.use('/api', sessionMiddleware);
app.use('/api', sameOrigin);
app.use('/api', apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
