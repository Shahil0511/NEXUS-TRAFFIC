/**
 * ROUTES.endpoints.* — the API Routes page (stats table + route detail).
 */
import {
  endpointDetailParamsSchema,
  endpointDetailQuerySchema,
  endpointListQuerySchema,
} from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { EndpointService } from '../../services/endpoint.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validParams, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class EndpointController {
  constructor(private readonly endpoints: EndpointService) {}

  /** @see ../../services/endpoint.service.ts EndpointService.list */
  list: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.endpoints.list(validQuery(res, endpointListQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/endpoint.service.ts EndpointService.detail */
  detail: RequestHandler = async (_req, res) => {
    const { endpointId } = validParams(res, endpointDetailParamsSchema);
    const query = validQuery(res, endpointDetailQuerySchema);
    const body = await this.endpoints.detail(endpointId, query, requireViewer(res));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
