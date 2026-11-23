/**
 * Small guards for dashboard routes.
 * - dashboardCsrf: every dashboard call must carry `X-Nexus-Dashboard: 1`. A custom header cannot be
 *   sent by a cross-site form/img, so this blocks CSRF even though all apps share the origin.
 * - requireAdmin: app/key management and the person-level reads.
 * - requireAdminForUserKey: open lists narrowed to one person by `?userKey=`.
 */
import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { ForbiddenError } from '../../errors/app-error';
import { requireViewer } from '../request-accessors';

export function dashboardCsrfMiddleware(): RequestHandler {
  return (req, _res, next) => {
    if (req.get(INGEST_HEADERS.dashboard) !== '1') {
      throw new ForbiddenError(
        `Missing ${INGEST_HEADERS.dashboard} header`,
        ERROR_CODES.CSRF_HEADER_MISSING,
      );
    }
    next();
  };
}

export function requireAdminMiddleware(): RequestHandler {
  return (_req, res, next) => {
    if (!requireViewer(res).isAdmin) throw new ForbiddenError('Admin access required');
    next();
  };
}

/**
 * WHY: a list that is open to every viewer becomes a person-level read once `?userKey=` narrows
 * it to ONE person (PERSON_FILTERED_ROUTE_LEAVES): then only admins may read it, like the person
 * page itself. MUST run after validateQuery (it reads the validated query).
 */
export function requireAdminForUserKeyMiddleware(): RequestHandler {
  return (_req, res, next) => {
    const query: unknown = res.locals.validated?.query;
    const narrowed =
      typeof query === 'object' &&
      query !== null &&
      (query as { userKey?: unknown }).userKey !== undefined;
    if (narrowed && !requireViewer(res).isAdmin) {
      throw new ForbiddenError("Admin access required to read one person's activity");
    }
    next();
  };
}
