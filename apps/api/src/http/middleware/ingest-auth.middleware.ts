/**
 * Ingest authentication middleware (sets res.locals.ingest).
 * - serverKeyAuth: X-Nexus-Key must be a SECRET key.
 * - anyKeyAuth:    either kind (GET /v1/ingest/verify).
 * Failures are thrown as 401/403 AppErrors; ipFailureLimit (registered before this middleware)
 * counts exactly those responses per client IP. Key usage (last_used_at / last_sdk) is recorded
 * by AppKeyAuthenticator itself (fire-and-forget).
 */
import { INGEST_HEADERS, type KeyKind } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { AppKeyAuthenticator } from '../../auth/app-key.authenticator';

function keyAuth(authenticator: AppKeyAuthenticator, expected: KeyKind | 'any'): RequestHandler {
  return async (req, res, next) => {
    const rawKey = req.get(INGEST_HEADERS.key);
    const sdk = req.get(INGEST_HEADERS.sdk) ?? null;
    res.locals.ingest = await authenticator.authenticate(rawKey, expected, sdk);
    next();
  };
}

/** WHY: POST ROUTES.ingest.server accepts only server-side (secret) keys. */
export function serverKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  return keyAuth(authenticator, 'secret');
}

/** WHY: GET ROUTES.ingest.verify lets either key kind check its wiring. */
export function anyKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  return keyAuth(authenticator, 'any');
}
