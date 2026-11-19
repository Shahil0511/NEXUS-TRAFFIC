/**
 * res.locals typing. Middleware writes these; controllers read them ONLY through
 * http/request-accessors.ts (typed, throws if a middleware is missing from the route).
 * NOTE: Express 5 makes `req.query` a getter — validated values live in res.locals.validated.
 */
import type { ErrorCode } from '@nexus/shared';

import type { AuthenticatedKey, Viewer } from '../../domain/viewer';

declare global {
  namespace Express {
    interface Locals {
      requestId?: string;
      validated?: { body?: unknown; query?: unknown; params?: unknown };
      viewer?: Viewer;
      ingest?: AuthenticatedKey;
      /**
       * The `error.code` of the response, set by errorHandlerMiddleware BEFORE it sends — read on
       * `finish` by ipFailureLimit (IP_FAILURE_ERROR_CODES only) and the rejection recorder.
       */
      errorCode?: ErrorCode;
    }
  }
}

export {};
