/**
 * THE route table — every endpoint of the API in one file, each path taken from ROUTES.
 * Read top to bottom: path → middleware chain → controller method (same name as the ROUTES leaf).
 */
import {
  appKeyParamsSchema,
  appSlugParamsSchema,
  browserIngestEnvelopeSchema,
  createAppBodySchema,
  createKeyBodySchema,
  endpointDetailParamsSchema,
  endpointDetailQuerySchema,
  endpointListQuerySchema,
  ERROR_CODES,
  errorListQuerySchema,
  errorSummaryQuerySchema,
  expireKeyBodySchema,
  geoQuerySchema,
  liveSnapshotQuerySchema,
  overviewAppsQuerySchema,
  overviewSummaryQuerySchema,
  overviewTimeseriesQuerySchema,
  pageListQuerySchema,
  ROUTES,
  serverIngestEnvelopeSchema,
  sessionListQuerySchema,
  sessionParamsSchema,
  sessionQuerySchema,
  toolUsageQuerySchema,
  topPathsQuerySchema,
  updateAppBodySchema,
  userKeyParamsSchema,
  userListQuerySchema,
  userProfileQuerySchema,
  userSearchBodySchema,
  userTimelineQuerySchema,
} from '@nexus/shared';
import { Router } from 'express';

import type { Container } from '../../container';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.middleware';

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
    validateBody(serverIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE),
    ctl.ingest.server,
  );
  // Browser: key in the BODY (sendBeacon, text/plain), so auth runs after parsing + envelope validation.
  // router.use (not r.options) keeps the route table to ROUTES leaves; it answers ONLY OPTIONS.
  r.use(ROUTES.ingest.browser.path, mw.browserIngestPreflight);
  r.post(
    ROUTES.ingest.browser.path,
    mw.browserIpFailureLimit,
    mw.beaconBody,
    mw.parseBeaconJson,
    validateBody(browserIngestEnvelopeSchema, ERROR_CODES.INVALID_ENVELOPE),
    mw.publishableKeyAuth,
    mw.browserIngestCors,
    mw.originGuard,
    mw.browserKeyRateLimit,
    mw.browserSessionRateLimit,
    ctl.ingest.browser,
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

  // ─── Dashboard: overview ──────────────────────────────────────────────────
  r.get(
    ROUTES.overview.summary.path,
    ...dashboard,
    validateQuery(overviewSummaryQuerySchema),
    ctl.overview.summary,
  );
  r.get(
    ROUTES.overview.timeseries.path,
    ...dashboard,
    validateQuery(overviewTimeseriesQuerySchema),
    ctl.overview.timeseries,
  );
  r.get(ROUTES.overview.apps.path, ...dashboard, validateQuery(overviewAppsQuerySchema), ctl.overview.apps);

  // ─── Dashboard: API routes ────────────────────────────────────────────────
  r.get(
    ROUTES.endpoints.list.path,
    ...dashboard,
    validateQuery(endpointListQuerySchema),
    ctl.endpoints.list,
  );
  r.get(
    ROUTES.endpoints.detail.path,
    ...dashboard,
    validateParams(endpointDetailParamsSchema),
    validateQuery(endpointDetailQuerySchema),
    ctl.endpoints.detail,
  );

  // ─── Dashboard: errors ────────────────────────────────────────────────────
  r.get(
    ROUTES.errors.summary.path,
    ...dashboard,
    validateQuery(errorSummaryQuerySchema),
    ctl.errors.summary,
  );
  r.get(
    ROUTES.errors.list.path,
    ...dashboard,
    validateQuery(errorListQuerySchema),
    ctl.errors.list,
  );

  // ─── Dashboard: users ─────────────────────────────────────────────────────
  r.get(ROUTES.users.list.path, ...dashboard, validateQuery(userListQuerySchema), ctl.users.list);
  // POST so the typed email stays out of the URL (ADR 0006); registered before `/:userKey`.
  r.post(
    ROUTES.users.search.path,
    ...dashboard,
    mw.dashboardJsonBody,
    validateBody(userSearchBodySchema),
    ctl.users.search,
  );
  r.get(
    ROUTES.users.profile.path,
    ...dashboard,
    validateParams(userKeyParamsSchema),
    validateQuery(userProfileQuerySchema),
    ctl.users.profile,
  );
  r.get(
    ROUTES.users.timeline.path,
    ...dashboard,
    validateParams(userKeyParamsSchema),
    validateQuery(userTimelineQuerySchema),
    ctl.users.timeline,
  );

  // ─── Dashboard: journeys ──────────────────────────────────────────────────
  r.get(
    ROUTES.journeys.sessions.path,
    ...dashboard,
    validateQuery(sessionListQuerySchema),
    ctl.journeys.sessions,
  );
  r.get(
    ROUTES.journeys.session.path,
    ...dashboard,
    validateParams(sessionParamsSchema),
    validateQuery(sessionQuerySchema),
    ctl.journeys.session,
  );
  r.get(
    ROUTES.journeys.topPaths.path,
    ...dashboard,
    validateQuery(topPathsQuerySchema),
    ctl.journeys.topPaths,
  );

  // ─── Dashboard: pages & tools ─────────────────────────────────────────────
  r.get(ROUTES.pages.list.path, ...dashboard, validateQuery(pageListQuerySchema), ctl.pages.list);
  r.get(ROUTES.tools.usage.path, ...dashboard, validateQuery(toolUsageQuerySchema), ctl.tools.usage);

  // ─── Dashboard: geography ─────────────────────────────────────────────────
  r.get(ROUTES.geo.countries.path, ...dashboard, validateQuery(geoQuerySchema), ctl.geo.countries);
  r.get(ROUTES.geo.cities.path, ...dashboard, validateQuery(geoQuerySchema), ctl.geo.cities);

  // ─── Dashboard: live (REST backfill; the stream is Socket.io — src/socket.ts) ─
  r.get(
    ROUTES.live.snapshot.path,
    ...dashboard,
    validateQuery(liveSnapshotQuerySchema),
    ctl.live.snapshot,
  );

  // ─── Dashboard: integration health ────────────────────────────────────────
  r.get(ROUTES.integration.health.path, ...dashboard, ctl.integration.health);

  return r;
}
