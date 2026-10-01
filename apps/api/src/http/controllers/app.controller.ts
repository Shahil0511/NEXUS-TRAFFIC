/**
 * ROUTES.apps.* — app registration and key management.
 * list: any dashboard user. Everything else: admins (requireAdmin on the route).
 */
import type { RequestHandler } from 'express';

import { notImplemented } from '../../lib/not-implemented';
import type { AppAdminService } from '../../services/app-admin.service';
import type { AppQueryService } from '../../services/app-query.service';

export class AppController {
  constructor(
    private readonly appQuery: AppQueryService,
    private readonly appAdmin: AppAdminService,
  ) {}

  list: RequestHandler = async (_req, _res) => {
    void this.appQuery;
    throw notImplemented('AppController.list');
  };

  create: RequestHandler = async (_req, _res) => {
    void this.appAdmin;
    throw notImplemented('AppController.create');
  };

  update: RequestHandler = async (_req, _res) => {
    throw notImplemented('AppController.update');
  };

  createKey: RequestHandler = async (_req, _res) => {
    throw notImplemented('AppController.createKey');
  };

  expireKey: RequestHandler = async (_req, _res) => {
    throw notImplemented('AppController.expireKey');
  };

  revokeKey: RequestHandler = async (_req, _res) => {
    throw notImplemented('AppController.revokeKey');
  };
}
