/**
 * ROUTES.apps.* — app registration and key management.
 * list: any dashboard user. Everything else: admins (requireAdmin on the route).
 */
import {
  appKeyParamsSchema,
  appSlugParamsSchema,
  createAppBodySchema,
  createKeyBodySchema,
  expireKeyBodySchema,
  updateAppBodySchema,
} from '@nexus/shared';
import type { RequestHandler } from 'express';

import type { AppAdminService } from '../../services/app-admin.service';
import type { AppQueryService } from '../../services/app-query.service';
import { requireViewer, validBody, validParams } from '../request-accessors';

/** WHY: the newly created key is in the body exactly once — no proxy or browser may cache it. */
const NO_STORE = 'no-store';

/** WHY: thin HTTP adapter — reads validated input, calls the same-named service method. */
export class AppController {
  constructor(
    private readonly appQuery: AppQueryService,
    private readonly appAdmin: AppAdminService,
  ) {}

  /** @see ../../services/app-query.service.ts AppQueryService.list */
  list: RequestHandler = async (_req, res) => {
    res.json(await this.appQuery.list());
  };

  /** @see ../../services/app-admin.service.ts AppAdminService.create */
  create: RequestHandler = async (_req, res) => {
    const body = validBody(res, createAppBodySchema);
    res.status(201).json(await this.appAdmin.create(body, requireViewer(res)));
  };

  /** @see ../../services/app-admin.service.ts AppAdminService.update */
  update: RequestHandler = async (_req, res) => {
    const { slug } = validParams(res, appSlugParamsSchema);
    const body = validBody(res, updateAppBodySchema);
    res.status(200).json(await this.appAdmin.update(slug, body, requireViewer(res)));
  };

  /** @see ../../services/app-admin.service.ts AppAdminService.createKey */
  createKey: RequestHandler = async (_req, res) => {
    const { slug } = validParams(res, appSlugParamsSchema);
    const body = validBody(res, createKeyBodySchema);
    const created = await this.appAdmin.createKey(slug, body, requireViewer(res));
    res.setHeader('Cache-Control', NO_STORE);
    res.status(201).json(created);
  };

  /** @see ../../services/app-admin.service.ts AppAdminService.expireKey */
  expireKey: RequestHandler = async (_req, res) => {
    const { slug, keyId } = validParams(res, appKeyParamsSchema);
    const body = validBody(res, expireKeyBodySchema);
    res.status(200).json(await this.appAdmin.expireKey(slug, keyId, body, requireViewer(res)));
  };

  /** @see ../../services/app-admin.service.ts AppAdminService.revokeKey */
  revokeKey: RequestHandler = async (_req, res) => {
    const { slug, keyId } = validParams(res, appKeyParamsSchema);
    res.status(200).json(await this.appAdmin.revokeKey(slug, keyId, requireViewer(res)));
  };
}
