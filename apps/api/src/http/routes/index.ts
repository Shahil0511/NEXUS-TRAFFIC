/**
 * THE route table — every endpoint of the API in one file, each path taken from ROUTES.
 * Read top to bottom: path → middleware chain → controller method (same name as the ROUTES leaf).
 */
import {
  appKeyParamsSchema,
  appSlugParamsSchema,
  createAppBodySchema,
  createKeyBodySchema,
  expireKeyBodySchema,
  ROUTES,
  serverIngestEnvelopeSchema,
  updateAppBodySchema,
} from '@nexus/shared';
import { Router } from 'express';

import type { Container } from '../../container';
import { validateBody, validateParams } from '../middleware/validate.middleware';

export function buildRouter(c: Container): Router {
  const r = Router();
  const ctl = c.controllers;
  const mw = c.middleware;
  const dashboard = [mw.ssoAuth, mw.dashboardCsrf];
  const admin = [...dashboard, mw.requireAdmin];

  // ─── Health (Docker healthchecks) ─────────────────────────────────────────
  r.get(ROUTES.health.live.path, ctl.health.live);
  r.get(ROUTES.health.ready.path, ctl.health.ready);

  // ─── Public docs (the link sent to other teams) ───────────────────────────
  r.get(ROUTES.docs.home.path, ctl.docs.home);
  r.get(ROUTES.docs.openapi.path, ctl.docs.openapi);
  r.get(ROUTES.docs.files.path, ctl.docs.files);

  // ─── Ingest (public contract v1) ──────────────────────────────────────────
  r.post(
    ROUTES.ingest.server.path,
    mw.ipFailureLimit,
    mw.serverIngestJsonBody,
    mw.serverKeyAuth,
    mw.serverKeyRateLimit,
    validateBody(serverIngestEnvelopeSchema),
    ctl.ingest.server,
  );
  r.get(ROUTES.ingest.verify.path, mw.ipFailureLimit, mw.anyKeyAuth, ctl.ingest.verify);

  // ─── Dashboard: me ────────────────────────────────────────────────────────
  r.get(ROUTES.me.get.path, ...dashboard, ctl.me.get);

  // ─── Dashboard: apps & keys ───────────────────────────────────────────────
  r.get(ROUTES.apps.list.path, ...dashboard, ctl.apps.list);
  r.post(ROUTES.apps.create.path, ...admin, mw.dashboardJsonBody, validateBody(createAppBodySchema), ctl.apps.create);
  r.patch(
    ROUTES.apps.update.path,
    ...admin,
    mw.dashboardJsonBody,
    validateParams(appSlugParamsSchema),
    validateBody(updateAppBodySchema),
    ctl.apps.update,
  );
  r.post(
    ROUTES.apps.createKey.path,
    ...admin,
    mw.dashboardJsonBody,
    validateParams(appSlugParamsSchema),
    validateBody(createKeyBodySchema),
    ctl.apps.createKey,
  );
  r.patch(
    ROUTES.apps.expireKey.path,
    ...admin,
    mw.dashboardJsonBody,
    validateParams(appKeyParamsSchema),
    validateBody(expireKeyBodySchema),
    ctl.apps.expireKey,
  );
  r.delete(ROUTES.apps.revokeKey.path, ...admin, validateParams(appKeyParamsSchema), ctl.apps.revokeKey);

  return r;
}
