import app from './app.js';
import { env } from './config/env.js';
import { closeDatabase } from './db/index.js';
import { drainBackground } from './utils/background.js';
import { logger } from './utils/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Server listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down');
  server.close();
  await drainBackground();
  await closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled rejection'));
