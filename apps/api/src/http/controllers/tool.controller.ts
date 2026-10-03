/**
 * ROUTES.tools.* — the "tool usage" table of the Pages & Tools page.
 */
import { toolUsageQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { ToolService } from '../../services/tool.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class ToolController {
  constructor(private readonly tools: ToolService) {}

  /** @see ../../services/tool.service.ts ToolService.usage */
  usage: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.tools.usage(validQuery(res, toolUsageQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
