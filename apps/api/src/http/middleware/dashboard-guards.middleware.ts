/**
 * Small guards for dashboard routes.
 * - dashboardCsrf: every dashboard call must carry `X-Nexus-Dashboard: 1`. A custom header cannot be
 *   sent by a cross-site form/img, so this blocks CSRF even though all apps share the origin.
 * - requireAdmin: app/key management.
 */
import { ERROR_CODES, INGEST_HEADERS } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { ForbiddenError } from '../../errors/app-error';
import { requireViewer } from '../request-accessors';

export function dashboardCsrfMiddleware(): RequestHandler {
  return (req, _res, next) => {
    if (req.get(INGEST_HEADERS.dashboard) !== '1') {
      throw new ForbiddenError(`Missing ${INGEST_HEADERS.dashboard} header`, ERROR_CODES.CSRF_HEADER_MISSING);
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
