/**
 * One access-log line per request (path WITHOUT query string). Health checks are skipped and
 * ingest calls are logged at debug — at full volume they would flood `docker compose logs`.
 */
import { ROUTES } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { Logger } from '../../lib/logger';

const HEALTH_PREFIX = `/api${ROUTES.health.live.path}`;
const INGEST_PREFIX = '/api/v1/ingest/';

export function accessLogMiddleware(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    if (path.startsWith(HEALTH_PREFIX)) return next();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const meta = { method: req.method, path, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10 };
      if (path.startsWith(INGEST_PREFIX)) logger.debug('http', meta);
      else logger.info('http', meta);
    });
    next();
  };
}
