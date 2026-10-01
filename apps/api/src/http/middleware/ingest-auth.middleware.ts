/**
 * Ingest authentication middleware (sets res.locals.ingest).
 * - serverKeyAuth: X-Nexus-Key must be a SECRET key.
 * - anyKeyAuth:    either kind (GET /v1/ingest/verify).
 * Failed authentications are counted per IP by `onAuthFailure` (ipFailureLimit).
 */
import type { RequestHandler } from 'express';

import type { AppKeyAuthenticator } from '../../auth/app-key.authenticator';
import { notImplemented } from '../../lib/not-implemented';

export function serverKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  void authenticator;
  return () => {
    throw notImplemented('serverKeyAuthMiddleware');
  };
}

export function anyKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  void authenticator;
  return () => {
    throw notImplemented('anyKeyAuthMiddleware');
  };
}
