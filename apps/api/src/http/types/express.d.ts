/**
 * res.locals typing. Middleware writes these; controllers read them ONLY through
 * http/request-accessors.ts (typed, throws if a middleware is missing from the route).
 * NOTE: Express 5 makes `req.query` a getter — validated values live in res.locals.validated.
 */
import type { AuthenticatedKey, Viewer } from '../../domain/viewer';

declare global {
  namespace Express {
    interface Locals {
      requestId?: string;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
      viewer?: Viewer;
      ingest?: AuthenticatedKey;
    }
  }
}

export {};
