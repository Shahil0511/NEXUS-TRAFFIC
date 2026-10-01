/**
 * ROUTES.errors.* — the Errors page (failure summary + failed-request list).
 */
import { errorListQuerySchema, errorSummaryQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { ErrorService } from '../../services/error.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class ErrorController {
  constructor(private readonly errors: ErrorService) {}

  /** @see ../../services/error.service.ts ErrorService.summary */
  summary: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.errors.summary(validQuery(res, errorSummaryQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/error.service.ts ErrorService.list */
  list: RequestHandler = async (_req, res) => {
    const body = await this.errors.list(validQuery(res, errorListQuerySchema), requireViewer(res));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
