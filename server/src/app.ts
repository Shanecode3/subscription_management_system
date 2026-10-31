import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { ForbiddenError } from './utils/errors';
import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requestLogger } from './middleware/request-logger.middleware';

function allowedOrigins(): string[] {
  const fromEnv = env.clientOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  // Vite may serve on either hostname; both are local and first-party.
  return Array.from(new Set([...fromEnv, 'http://localhost:5173', 'http://127.0.0.1:5173']));
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Requests without an Origin header (curl, server-to-server) are allowed.
        if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
        // Surface a readable 403 instead of a silent browser-side CORS failure.
        return callback(new ForbiddenError(`Origin ${origin} is not allowed to call this API.`));
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(requestLogger);

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
