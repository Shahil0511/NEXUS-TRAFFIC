/**
 * ROUTES.users.* — the Users page (user list, profile, devices, days, combined timeline).
 * profile / timeline / devices / daily are admin-only (requireAdmin in the route table) and pass
 * the viewer on, so the service can record the access.
 */
import {
  userActivityQuerySchema,
  userDailyQuerySchema,
  userDevicesQuerySchema,
  userKeyParamsSchema,
  userListQuerySchema,
  userProfileQuerySchema,
  userSearchBodySchema,
  userTimelineQuerySchema,
} from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { UserService } from '../../services/user.service';
import { CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE } from '../cache-control';
import { requireViewer, validBody, validParams, validQuery } from '../request-accessors';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class UserController {
  constructor(private readonly users: UserService) {}

  /** @see ../../services/user.service.ts UserService.list */
  list: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.users.list(validQuery(res, userListQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.activity */
  activity: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.users.activity(validQuery(res, userActivityQuerySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.search */
  search: RequestHandler = async (_req, res) => {
    requireViewer(res);
    const body = await this.users.search(validBody(res, userSearchBodySchema));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.profile */
  profile: RequestHandler = async (_req, res) => {
    const viewer = requireViewer(res);
    const { userKey } = validParams(res, userKeyParamsSchema);
    const body = await this.users.profile(userKey, validQuery(res, userProfileQuerySchema), viewer);
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.timeline */
  timeline: RequestHandler = async (_req, res) => {
    const { userKey } = validParams(res, userKeyParamsSchema);
    const query = validQuery(res, userTimelineQuerySchema);
    const body = await this.users.timeline(userKey, query, requireViewer(res));
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.devices */
  devices: RequestHandler = async (_req, res) => {
    const viewer = requireViewer(res);
    const { userKey } = validParams(res, userKeyParamsSchema);
    const body = await this.users.devices(userKey, validQuery(res, userDevicesQuerySchema), viewer);
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };

  /** @see ../../services/user.service.ts UserService.daily */
  daily: RequestHandler = async (_req, res) => {
    const viewer = requireViewer(res);
    const { userKey } = validParams(res, userKeyParamsSchema);
    const body = await this.users.daily(userKey, validQuery(res, userDailyQuerySchema), viewer);
    res.setHeader(CACHE_CONTROL_HEADER, DASHBOARD_ANALYTICS_CACHE);
    res.json(body);
  };
}
