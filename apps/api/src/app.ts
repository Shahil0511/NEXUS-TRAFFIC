/**
 * createApp: pure Express wiring — no listen, no timers (tests call it with a fake container).
 * Order: proxy trust → security headers → request id → access log → dev CORS → /api router → 404 → errors.
 */
import express, { type Express } from 'express';

import type { Container } from './container';
import { accessLogMiddleware } from './http/middleware/access-log.middleware';
import { errorHandlerMiddleware, notFoundMiddleware } from './http/middleware/error-handler.middleware';
import { requestContextMiddleware } from './http/middleware/request-context.middleware';
import { devCorsMiddleware, helmetMiddleware } from './http/middleware/security.middleware';
import { buildRouter } from './http/routes';

/** The API is mounted under /api (nginx maps https://nexus.libas.in/traffic/api → here). */
export const API_MOUNT_PATH = '/api';

export function createApp(c: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', c.config.env.TRUST_PROXY_HOPS);

  app.use(helmetMiddleware());
  app.use(requestContextMiddleware());
  app.use(accessLogMiddleware(c.logger));
  if (!c.config.isProduction && c.config.corsDevOrigins.length > 0) {
    app.use(devCorsMiddleware(c.config.corsDevOrigins));
  }

  app.use(API_MOUNT_PATH, buildRouter(c));

  app.use(notFoundMiddleware());
  app.use(errorHandlerMiddleware(c.logger));
  return app;
}
