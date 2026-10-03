/**
 * ROUTES.journeys.* — the Journeys page (session list, session replay, top 3-step paths).
 */
import {
  sessionListQuerySchema,
  sessionParamsSchema,
  sessionQuerySchema,
  topPathsQuerySchema,
} from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { JourneyService } from '../../services/journey.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validParams, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class JourneyController {
  constructor(private readonly journeys: JourneyService) {}

  /** @see ../../services/journey.service.ts JourneyService.sessions */
  sessions: RequestHandler = async (_req, res) => {
    const query = validQuery(res, sessionListQuerySchema);
    const body = await this.journeys.sessions(query, requireViewer(res));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/journey.service.ts JourneyService.session */
  session: RequestHandler = async (_req, res) => {
    const { app, sessionId } = validParams(res, sessionParamsSchema);
    const query = validQuery(res, sessionQuerySchema);
    const body = await this.journeys.session(app, sessionId, query, requireViewer(res));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/journey.service.ts JourneyService.topPaths */
  topPaths: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.journeys.topPaths(validQuery(res, topPathsQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
