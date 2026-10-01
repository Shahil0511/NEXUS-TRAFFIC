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
import { HealthController } from './http/controllers/health.controller';
import { IngestController } from './http/controllers/ingest.controller';
import { MeController } from './http/controllers/me.controller';
import { OverviewController } from './http/controllers/overview.controller';
import { dashboardCsrfMiddleware, requireAdminMiddleware } from './http/middleware/dashboard-guards.middleware';
import { anyKeyAuthMiddleware, serverKeyAuthMiddleware } from './http/middleware/ingest-auth.middleware';
import { dashboardJsonBody, serverIngestJsonBody } from './http/middleware/json-body.middleware';
import { ipFailureLimitMiddleware, keyRateLimitMiddleware } from './http/middleware/rate-limit.middleware';
import { ssoAuthMiddleware } from './http/middleware/sso-auth.middleware';
import { PartitionMaintenanceJob } from './jobs/partition-maintenance.job';
import { RetentionJob } from './jobs/retention.job';
import { SystemClock, type Clock } from './lib/clock';
import { createLogger, type Logger } from './lib/logger';
import { LiveFeed } from './live/live-feed';
import { AdminAuditRepository } from './repositories/admin-audit.repository';
import { ApiKeyRepository } from './repositories/api-key.repository';
import { ApiRequestIngestRepository } from './repositories/api-request-ingest.repository';
import { ApiRequestQueryRepository } from './repositories/api-request-query.repository';
import { AppRepository } from './repositories/app.repository';
import { HealthRepository } from './repositories/health.repository';
import { IngestCounterRepository } from './repositories/ingest-counter.repository';
import { PartitionRepository } from './repositories/partition.repository';
import { WebEventQueryRepository } from './repositories/web-event-query.repository';
import { AppAdminService } from './services/app-admin.service';
import { AppQueryService } from './services/app-query.service';
import { AppSlugResolver } from './services/app-slug.resolver';
import { EndpointService } from './services/endpoint.service';
import { ErrorService } from './services/error.service';
import { HealthService } from './services/health.service';
import { IngestService } from './services/ingest.service';
import { OverviewService } from './services/overview.service';
import { PartitionService } from './services/partition.service';

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
    ingestCounters: new IngestCounterRepository(pools.write),
    partitions: new PartitionRepository(pools.write),
    health: new HealthRepository(pools.query),
    // Dashboard reads: QUERY pool (read-only transactions), never queued behind ingest writes.
    apiRequestQuery: new ApiRequestQueryRepository(pools.query),
    webEventQuery: new WebEventQueryRepository(pools.query),
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

  // ─── Realtime ─────────────────────────────────────────────────────────────
  const liveFeed = new LiveFeed();

  // ─── Services ─────────────────────────────────────────────────────────────
  const appSlugs = new AppSlugResolver(repositories.apps);
  const services = {
    health: new HealthService(repositories.health, repositories.partitions, schemaGuard),
    partitions: new PartitionService(repositories.partitions, env.RAW_RETENTION_MONTHS, logger),
    ingest: new IngestService(
      repositories.apiRequestIngest,
      repositories.ingestCounters,
      repositories.partitions,
      serverEventEnricher,
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
      appSlugs,
      clock,
    ),
    endpoints: new EndpointService(repositories.apiRequestQuery, appSlugs, clock),
    errors: new ErrorService(repositories.apiRequestQuery, appSlugs, clock),
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
  };

  // ─── HTTP middleware instances ────────────────────────────────────────────
  const countRateLimited = (appId: string, source: 'server' | 'browser') => {
    void repositories.ingestCounters
      .increment({ appId, source, accepted: 0, duplicates: 0, rejected: 0, rateLimited: 1 }, clock.now())
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
    serverKeyRateLimit: keyRateLimitMiddleware(env.INGEST_RATE_LIMIT_SERVER_PER_MIN, countRateLimited, 'server'),
    ipFailureLimit: ipFailureLimitMiddleware(env.INGEST_IP_FAILURE_PER_MIN),
  };

  // ─── Jobs ─────────────────────────────────────────────────────────────────
  const jobs = {
    partitionMaintenance: new PartitionMaintenanceJob(pools.write, services.partitions),
    retention: new RetentionJob(pools.write, services.partitions, clock, logger),
  };

  return { config, logger, clock, pools, repositories, schemaGuard, services, controllers, middleware, jobs, liveFeed };
}

export type Container = ReturnType<typeof createContainer>;
