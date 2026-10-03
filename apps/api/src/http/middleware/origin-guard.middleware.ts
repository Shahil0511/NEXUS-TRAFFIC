/**
 * Origin allowlist of POST ROUTES.ingest.browser (after publishableKeyAuth, so the app is known).
 * The publishable key ships in every bundle, so the key alone proves nothing — the page origin must
 * be one of the app's `allowed_origins`:
 * - the Origin header decides; `Origin: null` (sandboxed iframes, file://) is rejected;
 * - only when Origin is ABSENT, the origin of the Referer header is used;
 * - neither → 403 ORIGIN_NOT_ALLOWED. Comparison is case-insensitive on `scheme://host[:port]`.
 */
import { ERROR_CODES } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { ForbiddenError } from '../../errors/app-error';
import { requireIngest } from '../request-accessors';

const OPAQUE_ORIGIN = 'null';

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const { origin } = new URL(referer);
    return origin === OPAQUE_ORIGIN ? null : origin;
  } catch {
    return null;
  }
}

/** WHY pure: the Origin/Referer precedence is the security rule — unit-tested on its own. */
export function requestOrigin(originHeader: string | undefined, refererHeader: string | undefined): string | null {
  if (originHeader !== undefined && originHeader !== '') {
    return originHeader === OPAQUE_ORIGIN ? null : originHeader;
  }
  return refererOrigin(refererHeader);
}

/** True when `origin` is one of `allowed` (case-insensitive; a trailing slash is ignored). */
export function isAllowedOrigin(origin: string | null, allowed: readonly string[]): boolean {
  if (!origin) return false;
  const wanted = origin.replace(/\/$/, '').toLowerCase();
  return allowed.some((candidate) => candidate.replace(/\/$/, '').toLowerCase() === wanted);
}

/** WHY: stops other sites from spending an app's publishable key (it is public by design). */
export function originGuardMiddleware(): RequestHandler {
  return (req, res, next) => {
    const { app } = requireIngest(res);
    const origin = requestOrigin(req.get('origin'), req.get('referer'));
    if (!isAllowedOrigin(origin, app.allowed_origins)) {
      throw new ForbiddenError('This origin is not allowed for this app', ERROR_CODES.ORIGIN_NOT_ALLOWED);
    }
    next();
  };
}
