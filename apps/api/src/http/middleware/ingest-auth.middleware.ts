/**
 * Ingest authentication middleware (sets res.locals.ingest).
 * - serverKeyAuth: X-Nexus-Key must be a SECRET key.
 * - anyKeyAuth:    either kind (GET /v1/ingest/verify).
 * - publishableKeyAuth: the `key` field of the VALIDATED browser envelope must be a PUBLISHABLE key
 *   (a secret key there → exposed_at set + 403 SECRET_KEY_EXPOSED, inside AppKeyAuthenticator), and
 *   the app must have browser ingest enabled (403 BROWSER_INGEST_DISABLED).
 * Failures are thrown as 401/403 AppErrors; ipFailureLimit (registered before this middleware)
 * counts exactly those responses per client IP. Key usage (last_used_at / last_sdk) is recorded
 * by AppKeyAuthenticator itself (fire-and-forget).
 */
import { browserIngestEnvelopeSchema, ERROR_CODES, INGEST_HEADERS, type KeyKind } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { AppKeyAuthenticator } from '../../auth/app-key.authenticator';
import { browserSdkOf } from '../../domain/browser-sdk';
import type { AppRow } from '../../domain/rows';
import { ForbiddenError } from '../../errors/app-error';
import { validBody } from '../request-accessors';

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

function assertBrowserIngestEnabled(app: AppRow): void {
  if (!app.browser_ingest_enabled) {
    throw new ForbiddenError('Browser ingest is disabled for this app', ERROR_CODES.BROWSER_INGEST_DISABLED);
  }
}

/**
 * WHY: POST ROUTES.ingest.browser carries its key in the BODY (sendBeacon cannot set headers), so
 * this runs AFTER validateBody(browserIngestEnvelopeSchema).
 */
export function publishableKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  return async (_req, res, next) => {
    const envelope = validBody(res, browserIngestEnvelopeSchema);
    const auth = await authenticator.authenticate(envelope.key, 'publishable', browserSdkOf(envelope));
    assertBrowserIngestEnabled(auth.app);
    res.locals.ingest = auth;
    next();
  };
}
