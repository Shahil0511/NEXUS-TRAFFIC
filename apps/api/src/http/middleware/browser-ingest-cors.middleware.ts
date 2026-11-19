/**
 * Route-scoped CORS of POST ROUTES.ingest.browser and POST ROUTES.ingest.config (the global CORS is
 * dev-only; see security.middleware.ts). Three pieces, because the app is known only after the body
 * is read:
 * - browserIngestPreflight (mounted with router.use on the path, before the POST): answers OPTIONS
 *   with 204 and reflects the Origin ONLY when some active, browser-enabled app allows it. Beacons
 *   and config polls (text/plain) never preflight; a JSON keepalive-fetch does.
 * - browserIngestEarlyCors (FIRST in the POST chain, before any auth — ADR 0009): reflects the
 *   Origin, with credentials, when ANY registered app lists it — whatever its is_active /
 *   browser_ingest_enabled (a LOOSER rule than the preflight: the kill switch IS
 *   browser_ingest_enabled = false, and a killed app's own origin must still read its 403) — so a
 *   cross-origin SDK can READ the 400/401/403/413/415 that auth and validation answer, and stop on a
 *   kill code instead of seeing an opaque TypeError. It only sets headers; nothing becomes
 *   acceptable through it (originGuard and auth still reject).
 * - browserIngestCors (in the POST chain, right after publishableKeyAuth): reflects the request's
 *   Origin ONLY when it is one of THIS app's allowed_origins, with credentials (the SSO cookie rides
 *   on the beacon), so the SDK may read the 202 — and the 429/503 that follow. Never `*`.
 *   It only sets headers; originGuard (next in the chain) is what REJECTS other origins.
 * Both "some app" checks go through an AllowedOriginCache (30 s; one instance per rule, wired in
 * container.ts), so beacons add no DB query.
 * @see ../../auth/allowed-origin.cache.ts AllowedOriginCache.allows
 */
import { INGEST_HEADERS } from '@nexus/shared';
import type { RequestHandler, Response } from 'express';

import type { AllowedOriginCache } from '../../auth/allowed-origin.cache';
import { requireIngest } from '../request-accessors';
import { isAllowedOrigin, requestOrigin } from './origin-guard.middleware';

const PREFLIGHT_METHOD = 'OPTIONS';
const NO_CONTENT = 204;
/** Browsers cap this (Chromium: 2 h); one preflight per origin per 2 h is plenty. */
const PREFLIGHT_MAX_AGE_SECONDS = 7200;
/** Response headers a cross-origin SDK may read (contract mismatch, back-off). */
const EXPOSED_HEADERS = `${INGEST_HEADERS.contract}, Retry-After`;

function reflectOrigin(res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

/** WHY: the response differs per Origin, so caches must key on it even when nothing is reflected. */
function varyOnOrigin(res: Response): void {
  res.vary('Origin');
}

/** WHY: lets a JSON keepalive-fetch from a registered origin through its preflight — and no one else. */
export function browserIngestPreflightMiddleware(origins: AllowedOriginCache): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== PREFLIGHT_METHOD) {
      next();
      return;
    }
    varyOnOrigin(res);
    const origin = requestOrigin(req.get('origin'), undefined);
    if (origin && (await origins.allows(origin))) {
      reflectOrigin(res, origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS));
    }
    res.status(NO_CONTENT).end();
  };
}

/**
 * WHY: pre-auth errors (bad key, kill switch, bad envelope) must be readable by a REGISTERED origin,
 * or the browser SDK can never tell "killed" from "network down". `origins` must be the
 * `registered`-rule cache (killed / disabled apps included). A lookup failure only means no
 * headers (the request itself carries on and fails or succeeds on its own merits).
 */
export function browserIngestEarlyCorsMiddleware(origins: AllowedOriginCache): RequestHandler {
  return async (req, res, next) => {
    varyOnOrigin(res);
    const origin = requestOrigin(req.get('origin'), undefined);
    let allowed = false;
    try {
      allowed = origin !== null && (await origins.allows(origin));
    } catch {
      allowed = false;
    }
    if (origin && allowed) {
      reflectOrigin(res, origin);
      res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }
    next();
  };
}

/** WHY: a credentialed cross-origin POST is readable only with the exact origin reflected. */
export function browserIngestCorsMiddleware(): RequestHandler {
  return (req, res, next) => {
    varyOnOrigin(res);
    const origin = requestOrigin(req.get('origin'), undefined);
    if (origin && isAllowedOrigin(origin, requireIngest(res).app.allowed_origins)) {
      reflectOrigin(res, origin);
      res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    }
    next();
  };
}
