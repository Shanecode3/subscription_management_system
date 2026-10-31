import { createApp } from './app';
import { env } from './config/env';
import { closePool, isDatabaseReachable } from './db/pool';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  const app = createApp();

  // Listen first, then probe the database. A slow or absent database must not
  // stop the API from serving a clear /health error.
  const server = app.listen(env.port, () => {
    logger.info(`Brightloop API listening on http://localhost:${env.port}/api/v1`);
  });

  void isDatabaseReachable().then((reachable) => {
    if (reachable) {
      logger.info('PostgreSQL connection verified.');
    } else {
      logger.warn(
        'PostgreSQL is unreachable. Set DATABASE_URL in server/.env, then run `npm run db:setup`.',
      );
    }
  });

  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, shutting down.`);

    server.close(() => {
      void closePool()
        .catch((error: unknown) => logger.error('Error while closing the pool', error))
        .finally(() => process.exit(0));
    });

    // Do not let a stuck connection hold the process open forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', reason);
  });
}

bootstrap().catch((error: unknown) => {
  logger.error('Failed to start the API', error);
  process.exit(1);
});
