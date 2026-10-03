/**
 * Route-scoped CORS of POST ROUTES.ingest.browser (the global CORS is dev-only; see
 * security.middleware.ts). Two pieces, because the app is known only after the body is read:
 * - browserIngestPreflight (mounted with router.use on the path, before the POST): answers OPTIONS
 *   with 204 and reflects the Origin ONLY when some active, browser-enabled app allows it. Beacons
 *   (text/plain) never preflight; a JSON keepalive-fetch does.
 * - browserIngestCors (in the POST chain, right after publishableKeyAuth): reflects the request's
 *   Origin ONLY when it is one of THIS app's allowed_origins, with credentials (the SSO cookie rides
 *   on the beacon), so the SDK may read the 202 — and the 429/503 that follow. Never `*`.
 *   It only sets headers; originGuard (next in the chain) is what REJECTS other origins.
 * @see ../../repositories/app.repository.ts AppRepository.anyAllowsOrigin
 */
import { INGEST_HEADERS } from '@nexus/shared';
import type { RequestHandler, Response } from 'express';

import type { AppRepository } from '../../repositories/app.repository';
import { requireIngest } from '../request-accessors';
import { isAllowedOrigin, requestOrigin } from './origin-guard.middleware';

const PREFLIGHT_METHOD = 'OPTIONS';
const NO_CONTENT = 204;
/** Browsers cap this (Chromium: 2 h); one preflight per origin per 2 h is plenty. */
const PREFLIGHT_MAX_AGE_SECONDS = 7200;

function reflectOrigin(res: Response, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

/** WHY: the response differs per Origin, so caches must key on it even when nothing is reflected. */
function varyOnOrigin(res: Response): void {
  res.vary('Origin');
}

/** WHY: lets a JSON keepalive-fetch from a registered origin through its preflight — and no one else. */
export function browserIngestPreflightMiddleware(apps: AppRepository): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== PREFLIGHT_METHOD) {
      next();
      return;
    }
    varyOnOrigin(res);
    const origin = requestOrigin(req.get('origin'), undefined);
    if (origin && (await apps.anyAllowsOrigin(origin))) {
      reflectOrigin(res, origin);
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Max-Age', String(PREFLIGHT_MAX_AGE_SECONDS));
    }
    res.status(NO_CONTENT).end();
  };
}

/** WHY: a credentialed cross-origin POST is readable only with the exact origin reflected. */
export function browserIngestCorsMiddleware(): RequestHandler {
  return (req, res, next) => {
    varyOnOrigin(res);
    const origin = requestOrigin(req.get('origin'), undefined);
    if (origin && isAllowedOrigin(origin, requireIngest(res).app.allowed_origins)) {
      reflectOrigin(res, origin);
      res.setHeader('Access-Control-Expose-Headers', `${INGEST_HEADERS.contract}, Retry-After`);
    }
    next();
  };
}
