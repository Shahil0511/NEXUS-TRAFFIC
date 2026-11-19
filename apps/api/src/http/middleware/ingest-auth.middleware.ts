/**
 * Ingest authentication middleware (sets res.locals.ingest).
 * - serverKeyAuth: X-Nexus-Key must be a SECRET key.
 * - anyKeyAuth:    either kind (GET /v1/ingest/verify).
 * - publishableKeyAuth: the `key` field of the VALIDATED body (browser envelope, or SDK config
 *   request) must be a PUBLISHABLE key (a secret key there → exposed_at set + 403
 *   SECRET_KEY_EXPOSED, inside AppKeyAuthenticator), and the app must have browser ingest enabled
 *   (403 BROWSER_INGEST_DISABLED — the kill switch, ADR 0009).
 * Failures are thrown as 401/403 AppErrors; ipFailureLimit (registered before this middleware)
 * counts only the key-guess failures among them (KEY_GUESS_ERROR_CODES, plus originGuard's
 * ORIGIN_NOT_ALLOWED — IP_FAILURE_ERROR_CODES, read via res.locals.errorCode, ADR 0009); policy
 * denials such as BROWSER_INGEST_DISABLED, APP_DISABLED and SECRET_KEY_EXPOSED do not count.
 * Key usage (last_used_at / last_sdk) is recorded by AppKeyAuthenticator itself (fire-and-forget).
 */
import { ERROR_CODES, INGEST_HEADERS, sdkConfigRequestSchema, type KeyKind } from '@nexus/shared';
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
 * WHY: POST ROUTES.ingest.browser and POST ROUTES.ingest.config carry the key in the BODY
 * (sendBeacon cannot set headers; a key in a URL would reach access logs), so this runs AFTER
 * validateBody(browserIngestEnvelopeSchema | sdkConfigRequestSchema). The `client` label is the
 * same on both routes, so api_keys.last_sdk stays meaningful.
 */
export function publishableKeyAuthMiddleware(authenticator: AppKeyAuthenticator): RequestHandler {
  return async (_req, res, next) => {
    // `{key, client?}` — the config request's shape, which the browser envelope also has.
    const body = validBody(res, sdkConfigRequestSchema);
    const auth = await authenticator.authenticate(body.key, 'publishable', browserSdkOf(body));
    assertBrowserIngestEnabled(auth.app);
    res.locals.ingest = auth;
    next();
  };
}
