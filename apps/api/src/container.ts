/**
 * THE composition root. Every class is constructed here, once, with its dependencies — so
 * "Go to Definition" on any `this.x` in a service lands on a real class, and tests can swap any
 * piece through `overrides`.
 */
import type { Pool } from 'pg';

import { ApiKeyGenerator } from './auth/api-key.generator';
import { ApiKeyHasher } from './auth/api-key.hasher';
import { AppKeyAuthenticator } from './auth/app-key.authenticator';
import { AppKeyCache } from './auth/app-key.cache';
import { DashboardAccessPolicy } from './auth/dashboard-access.policy';
import { SsoIdentityReader } from './auth/sso-identity.reader';
import type { AppConfig } from './config';
import { SchemaGuard } from './db/migration-runner/schema-guard';
import { createQueryPool, createWritePool } from './db/pool';
import { MIGRATIONS_DIR } from './db/schema';
import { BrowserEventEnricher } from './enrichment/browser-event.enricher';
import { EventTimeGuard } from './enrichment/event-time.guard';
import { GeoIpEnricher } from './enrichment/geo-ip.enricher';
import { IdentityResolver } from './enrichment/identity.resolver';
import { IpAnonymizer } from './enrichment/ip.anonymizer';
import { PathSanitizer } from './enrichment/path.sanitizer';
import { RouteNormalizer } from './enrichment/route.normalizer';
import { ServerEventEnricher } from './enrichment/server-event.enricher';
import { UserAgentParser } from './enrichment/user-agent.parser';
import { UserKeyHasher } from './enrichment/user-key.hasher';
import { AppController } from './http/controllers/app.controller';
import { DocsController } from './http/controllers/docs.controller';
import { EndpointController } from './http/controllers/endpoint.controller';
import { ErrorController } from './http/controllers/error.controller';
import { GeoController } from './http/controllers/geo.controller';
import { HealthController } from './http/controllers/health.controller';
import { IngestController } from './http/controllers/ingest.controller';
import { IntegrationController } from './http/controllers/integration.controller';
import { JourneyController } from './http/controllers/journey.controller';
import { LiveController } from './http/controllers/live.controller';
import { MeController } from './http/controllers/me.controller';
import { OverviewController } from './http/controllers/overview.controller';
import { PageController } from './http/controllers/page.controller';
import { ToolController } from './http/controllers/tool.controller';
import { UserController } from './http/controllers/user.controller';
import {
  dashboardCsrfMiddleware,
  requireAdminMiddleware,
} from './http/middleware/dashboard-guards.middleware';
import { beaconBodyMiddleware } from './http/middleware/beacon-body.middleware';
import {
  browserIngestCorsMiddleware,
  browserIngestPreflightMiddleware,
} from './http/middleware/browser-ingest-cors.middleware';
import {
  anyKeyAuthMiddleware,
  publishableKeyAuthMiddleware,
  serverKeyAuthMiddleware,
} from './http/middleware/ingest-auth.middleware';
import { dashboardJsonBody, serverIngestJsonBody } from './http/middleware/json-body.middleware';
import { originGuardMiddleware } from './http/middleware/origin-guard.middleware';
import { parseBeaconJsonMiddleware } from './http/middleware/parse-beacon-json.middleware';
import {
  ipFailureLimitMiddleware,
  keyRateLimitMiddleware,
  sessionRateLimitMiddleware,
} from './http/middleware/rate-limit.middleware';
import { ssoAuthMiddleware } from './http/middleware/sso-auth.middleware';
import { PartitionMaintenanceJob } from './jobs/partition-maintenance.job';
import { RetentionJob } from './jobs/retention.job';
import { SystemClock, type Clock } from './lib/clock';
import { createLogger, type Logger } from './lib/logger';
import { LiveBroadcaster } from './live/live.broadcaster';
import { LiveFeed } from './live/live-feed';
import { LiveSessionSweeper } from './live/live-session.sweeper';
import { LiveSubscriptionHandler } from './live/live-subscription.handler';
import { LiveWindow } from './live/live-window';
import { socketAuthMiddleware } from './live/socket-auth.middleware';
import { AdminAuditRepository } from './repositories/admin-audit.repository';
import { ApiKeyRepository } from './repositories/api-key.repository';
import { ApiRequestIngestRepository } from './repositories/api-request-ingest.repository';
import { ApiRequestQueryRepository } from './repositories/api-request-query.repository';
import { AppRepository } from './repositories/app.repository';
import { HealthRepository } from './repositories/health.repository';
import { IngestCounterRepository } from './repositories/ingest-counter.repository';
import { IngestHealthRepository } from './repositories/ingest-health.repository';
import { PartitionRepository } from './repositories/partition.repository';
import { WebEventIngestRepository } from './repositories/web-event-ingest.repository';
import { WebEventQueryRepository } from './repositories/web-event-query.repository';
import { AppAdminService } from './services/app-admin.service';
import { AppQueryService } from './services/app-query.service';
import { AppSlugResolver } from './services/app-slug.resolver';
import { EndpointService } from './services/endpoint.service';
import { ErrorService } from './services/error.service';
import { GeoService } from './services/geo.service';
import { HealthService } from './services/health.service';
import { IngestService } from './services/ingest.service';
import { IntegrationService } from './services/integration.service';
import { JourneyService } from './services/journey.service';
import { LiveService } from './services/live.service';
import { OverviewService } from './services/overview.service';
import { PageService } from './services/page.service';
import { PartitionService } from './services/partition.service';
import { ToolService } from './services/tool.service';
import { UserService } from './services/user.service';

export interface ContainerOverrides {
  logger?: Logger;
  clock?: Clock;
  writePool?: Pool;
  queryPool?: Pool;
}

export function createContainer(config: AppConfig, overrides: ContainerOverrides = {}) {
  const { env } = config;
  const logger = overrides.logger ?? createLogger(env.LOG_LEVEL);
  const clock = overrides.clock ?? new SystemClock();
  const pools = {
    write: overrides.writePool ?? createWritePool(env.DATABASE_URL, env.PG_POOL_WRITE_MAX, logger),
    query: overrides.queryPool ?? createQueryPool(env.DATABASE_URL, env.PG_POOL_QUERY_MAX, logger),
  };

  // ─── Repositories ─────────────────────────────────────────────────────────
  const repositories = {
    apps: new AppRepository(pools.write),
    apiKeys: new ApiKeyRepository(pools.write),
    audit: new AdminAuditRepository(pools.write),
    apiRequestIngest: new ApiRequestIngestRepository(pools.write),
    webEventIngest: new WebEventIngestRepository(pools.write),
    ingestCounters: new IngestCounterRepository(pools.write),
    partitions: new PartitionRepository(pools.write),
    health: new HealthRepository(pools.query),
    // Dashboard reads: QUERY pool (read-only transactions), never queued behind ingest writes.
    apiRequestQuery: new ApiRequestQueryRepository(pools.query),
    webEventQuery: new WebEventQueryRepository(pools.query),
    ingestHealth: new IngestHealthRepository(pools.query),
  };
  const schemaGuard = new SchemaGuard(pools.query, MIGRATIONS_DIR);

  // ─── Auth ─────────────────────────────────────────────────────────────────
  const ssoReader = new SsoIdentityReader(env.LIBAS_JWT_SECRET, clock, logger);
  const accessPolicy = new DashboardAccessPolicy(config.accessPolicy);
  const keyHasher = new ApiKeyHasher(env.API_KEY_PEPPER);
  const keyGenerator = new ApiKeyGenerator(keyHasher);
  const keyCache = new AppKeyCache(clock);
  const keyAuthenticator = new AppKeyAuthenticator(
    repositories.apiKeys,
    repositories.apps,
    keyHasher,
    keyCache,
    clock,
    logger,
  );

  // ─── Enrichment ───────────────────────────────────────────────────────────
  const enrichment = {
    paths: new PathSanitizer(),
    routes: new RouteNormalizer(),
    ips: new IpAnonymizer(env.IP_STORAGE_MODE, env.IP_HASH_SECRET),
    geo: new GeoIpEnricher(),
    userAgents: new UserAgentParser(),
    identity: new IdentityResolver(ssoReader),
    userKeys: new UserKeyHasher(env.USER_KEY_SECRET),
    timeGuard: new EventTimeGuard(),
  };
  const serverEventEnricher = new ServerEventEnricher(
    enrichment.paths,
    enrichment.routes,
    enrichment.ips,
    enrichment.geo,
    enrichment.userAgents,
    enrichment.identity,
    enrichment.userKeys,
  );
  const browserEventEnricher = new BrowserEventEnricher(
    enrichment.paths,
    enrichment.routes,
    enrichment.ips,
    enrichment.geo,
    enrichment.userAgents,
    enrichment.identity,
    enrichment.userKeys,
  );

  // ─── Realtime (the Socket.io server itself is attached in src/socket.ts) ──
  const liveWindow = new LiveWindow();
  const liveBroadcaster = new LiveBroadcaster(liveWindow);
  const liveFeed = new LiveFeed(liveWindow, liveBroadcaster, clock);

  // ─── Services ─────────────────────────────────────────────────────────────
  const appSlugs = new AppSlugResolver(repositories.apps);
  const services = {
    health: new HealthService(repositories.health, repositories.partitions, schemaGuard),
    partitions: new PartitionService(repositories.partitions, env.RAW_RETENTION_MONTHS, logger),
    ingest: new IngestService(
      repositories.apiRequestIngest,
      repositories.webEventIngest,
      repositories.ingestCounters,
      repositories.partitions,
      serverEventEnricher,
      browserEventEnricher,
      enrichment.timeGuard,
      liveFeed,
      logger,
    ),
    appQuery: new AppQueryService(repositories.apps, repositories.apiKeys),
    appAdmin: new AppAdminService(
      pools.write,
      repositories.apps,
      repositories.apiKeys,
      repositories.audit,
      keyGenerator,
      keyCache,
      clock,
    ),
    appSlugs,
    overview: new OverviewService(
      repositories.apiRequestQuery,
      repositories.webEventQuery,
      repositories.apps,
      appSlugs,
      clock,
    ),
    endpoints: new EndpointService(repositories.apiRequestQuery, appSlugs, clock),
    errors: new ErrorService(repositories.apiRequestQuery, appSlugs, clock),
    users: new UserService(repositories.webEventQuery, appSlugs, clock),
    journeys: new JourneyService(repositories.webEventQuery, appSlugs, clock),
    pages: new PageService(repositories.webEventQuery, appSlugs, clock),
    tools: new ToolService(repositories.webEventQuery, appSlugs, clock),
    geo: new GeoService(repositories.webEventQuery, appSlugs, clock),
    live: new LiveService(
      repositories.apiRequestQuery,
      repositories.webEventQuery,
      appSlugs,
      clock,
    ),
    integration: new IntegrationService(repositories.ingestHealth, clock),
  };
  const realtime = {
    window: liveWindow,
    broadcaster: liveBroadcaster,
    feed: liveFeed,
    socketAuth: socketAuthMiddleware(ssoReader, accessPolicy),
    subscriptions: new LiveSubscriptionHandler(appSlugs, logger),
    sweeper: new LiveSessionSweeper(accessPolicy),
  };

  // ─── Controllers ──────────────────────────────────────────────────────────
  const controllers = {
    health: new HealthController(services.health),
    docs: new DocsController(config.docsDir),
    ingest: new IngestController(services.ingest, clock),
    me: new MeController(),
    apps: new AppController(services.appQuery, services.appAdmin),
    overview: new OverviewController(services.overview),
    endpoints: new EndpointController(services.endpoints),
    errors: new ErrorController(services.errors),
    users: new UserController(services.users),
    journeys: new JourneyController(services.journeys),
    pages: new PageController(services.pages),
    tools: new ToolController(services.tools),
    geo: new GeoController(services.geo),
    live: new LiveController(services.live),
    integration: new IntegrationController(services.integration),
  };

  // ─── HTTP middleware instances ────────────────────────────────────────────
  const countRateLimited = (appId: string, source: 'server' | 'browser') => {
    void repositories.ingestCounters
      .increment(
        { appId, source, accepted: 0, duplicates: 0, rejected: 0, rateLimited: 1 },
        clock.now(),
      )
      .catch((err: unknown) => logger.warn('rate-limit counter failed', { err }));
  };
  const middleware = {
    ssoAuth: ssoAuthMiddleware(ssoReader, accessPolicy),
    dashboardCsrf: dashboardCsrfMiddleware(),
    requireAdmin: requireAdminMiddleware(),
    dashboardJsonBody: dashboardJsonBody(),
    serverIngestJsonBody: serverIngestJsonBody(),
    serverKeyAuth: serverKeyAuthMiddleware(keyAuthenticator),
    anyKeyAuth: anyKeyAuthMiddleware(keyAuthenticator),
    serverKeyRateLimit: keyRateLimitMiddleware(
      env.INGEST_RATE_LIMIT_SERVER_PER_MIN,
      countRateLimited,
      'server',
    ),
    ipFailureLimit: ipFailureLimitMiddleware(env.INGEST_IP_FAILURE_PER_MIN),
    // ─── Browser ingest (POST ROUTES.ingest.browser) ───
    browserIngestPreflight: browserIngestPreflightMiddleware(repositories.apps),
    // Own instance: rejected beacons from a shared office IP never throttle server ingest.
    browserIpFailureLimit: ipFailureLimitMiddleware(env.INGEST_IP_FAILURE_PER_MIN),
    beaconBody: beaconBodyMiddleware(),
    parseBeaconJson: parseBeaconJsonMiddleware(),
    publishableKeyAuth: publishableKeyAuthMiddleware(keyAuthenticator),
    browserIngestCors: browserIngestCorsMiddleware(),
    originGuard: originGuardMiddleware(),
    browserKeyRateLimit: keyRateLimitMiddleware(
      env.INGEST_RATE_LIMIT_BROWSER_PER_MIN,
      countRateLimited,
      'browser',
    ),
    browserSessionRateLimit: sessionRateLimitMiddleware(
      env.INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN,
      countRateLimited,
    ),
  };

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  const jobs = {
    partitionMaintenance: new PartitionMaintenanceJob(pools.write, services.partitions),
    retention: new RetentionJob(pools.write, services.partitions, clock, logger),
  };

  return {
    config,
    logger,
    clock,
    pools,
    repositories,
    schemaGuard,
    services,
    controllers,
    middleware,
    jobs,
    realtime,
  };
}

export type Container = ReturnType<typeof createContainer>;
