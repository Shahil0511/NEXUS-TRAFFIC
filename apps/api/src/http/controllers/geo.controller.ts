/**
 * ROUTES.geo.* — the Geography page (countries, approximate cities).
 */
import { geoQuerySchema } from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { GeoService } from '../../services/geo.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  /** @see ../../services/geo.service.ts GeoService.countries */
  countries: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.geo.countries(validQuery(res, geoQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/geo.service.ts GeoService.cities */
  cities: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.geo.cities(validQuery(res, geoQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
