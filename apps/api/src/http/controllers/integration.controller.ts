/**
 * ROUTES.integration.* — the Integration page (per-app ingest health).
 */
import type { RequestHandler } from 'express';

import type { IntegrationService } from '../../services/integration.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer } from '../request-accessors';

/** WHY: thin HTTP adapter — calls the same-named service method. */
export class IntegrationController {
  constructor(private readonly integration: IntegrationService) {}

  /** @see ../../services/integration.service.ts IntegrationService.health */
  health: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.integration.health();
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
