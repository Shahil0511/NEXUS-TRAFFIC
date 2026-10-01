/**
 * ROUTES.overview.* — the Overview page (KPI cards + traffic chart).
 */
import { overviewSummaryQuerySchema, overviewTimeseriesQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { OverviewService } from '../../services/overview.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  /** @see ../../services/overview.service.ts OverviewService.summary */
  summary: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.overview.summary(validQuery(res, overviewSummaryQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/overview.service.ts OverviewService.timeseries */
  timeseries: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.overview.timeseries(validQuery(res, overviewTimeseriesQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
