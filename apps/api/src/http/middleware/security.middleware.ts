/**
 * Security headers and development CORS.
 * - helmet: the API serves JSON, so the default CSP is "nothing" (the docs controller sets its own).
 * - CORS: production is same-origin behind nginx, so CORS is enabled ONLY outside production, for
 *   CORS_DEV_ORIGINS (e.g. the Next dev server). Browser ingest has its own route-scoped CORS.
 */
import { INGEST_HEADERS } from '@nexus/shared';
import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

export function helmetMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
}

export function devCorsMiddleware(origins: string[]): RequestHandler {
  return cors({
    origin: origins,
    credentials: true,
    allowedHeaders: ['content-type', INGEST_HEADERS.dashboard.toLowerCase(), INGEST_HEADERS.requestId.toLowerCase()],
    exposedHeaders: [INGEST_HEADERS.requestId],
  });
}
