/**
 * ROUTES.pages.* — the "time on page" table of the Pages & Tools page.
 */
import { pageListQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { PageService } from '../../services/page.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class PageController {
  constructor(private readonly pages: PageService) {}

  /** @see ../../services/page.service.ts PageService.list */
  list: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.pages.list(validQuery(res, pageListQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
