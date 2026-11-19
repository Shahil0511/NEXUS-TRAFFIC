/**
 * ROUTES.integration.health — the Integration page: is each registered app actually sending, with
 * which SDKs, how much was accepted / rejected / throttled, and what to fix.
 */
import {
  INTEGRATION_HEALTH_WINDOW_MS,
  type AppIntegrationHealthDto,
  type IntegrationHealthDto,
} from '@nexus/shared';

import {
  countersBySource,
  identityCoverageOf,
  integrationLevelOf,
  integrationStatusOf,
  integrationWarningsOf,
  linkingCoverageOf,
  privateIpRatioOf,
  releaseStatusOf,
} from '../domain/integration-health';
import {
  mapEnvironmentMix,
  mapExposedKey,
  mapIngestCounter,
  mapPiiDetection,
  mapRejectionReason,
  mapSdkHealth,
  mapSsoCookieOutcome,
} from '../domain/mappers';
import type { AppHealthRow, IngestHealthRows } from '../domain/rows';
import type { Clock } from '../lib/clock';
import type { IngestHealthRepository } from '../repositories/ingest-health.repository';

/** WHY: the four row lists are flat (one query each); this picks one app's share of each. */
function rowsOfApp<T extends { app_id: string }>(rows: readonly T[], appId: string): T[] {
  return rows.filter((row) => row.app_id === appId);
}

/** WHY: one app's DTO from its rows — mapping + the pure rules of domain/integration-health.ts. */
function toAppHealth(
  app: AppHealthRow,
  rows: IngestHealthRows,
  now: Date,
): AppIntegrationHealthDto {
  const sdkRows = rowsOfApp(rows.sdks, app.app_id).sort((a, b) => b.events - a.events);
  const sdks = sdkRows.map(mapSdkHealth);
  const counters = countersBySource(rowsOfApp(rows.counters, app.app_id).map(mapIngestCounter));
  const exposedKeys = rowsOfApp(rows.exposedKeys, app.app_id).map(mapExposedKey);
  const privateIpRatio = privateIpRatioOf(sdkRows);
  const status = integrationStatusOf(app.last_server_at, app.last_browser_at, now);
  const piiDetections = rowsOfApp(rows.piiDetections, app.app_id).map(mapPiiDetection);
  const warnings = integrationWarningsOf({
    isActive: app.is_active,
    status,
    exposedKeys: exposedKeys.length,
    piiDetections: piiDetections.reduce((total, row) => total + row.detections, 0),
    privateIpRatio,
    sdks,
    counters,
  });
  const identityCoverage = identityCoverageOf(sdkRows);
  const linkingCoverage = linkingCoverageOf(sdkRows);
  const releases = releaseStatusOf(sdkRows);
  return {
    app: app.slug,
    displayName: app.display_name,
    isActive: app.is_active,
    status,
    lastServerEventAt: app.last_server_at?.toISOString() ?? null,
    lastBrowserEventAt: app.last_browser_at?.toISOString() ?? null,
    sdks,
    counters,
    exposedKeys,
    privateIpRatio,
    warnings,
    identityCoverage,
    linkingCoverage,
    environments: rowsOfApp(rows.environmentMix, app.app_id).map(mapEnvironmentMix),
    releases,
    piiDetections,
    rejections: rowsOfApp(rows.rejections, app.app_id).map(mapRejectionReason),
    ssoCookieOutcomes: rowsOfApp(rows.ssoOutcomes, app.app_id).map(mapSsoCookieOutcome),
    level: integrationLevelOf({ status, identityCoverage, linkingCoverage, releases, warnings }),
  };
}

/** WHY: any dashboard user may check an app's wiring (no IPs, no secrets — key PREFIXES only). */
export class IntegrationService {
  constructor(
    private readonly ingestHealth: IngestHealthRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Every registered app over the trailing INTEGRATION_HEALTH_WINDOW_MS, in slug order.
   * @see ../repositories/ingest-health.repository.ts IngestHealthRepository.perApp
   */
  async health(): Promise<IntegrationHealthDto> {
    const to = this.clock.now();
    const from = new Date(to.getTime() - INTEGRATION_HEALTH_WINDOW_MS);
    const rows = await this.ingestHealth.perApp(from, to);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      apps: rows.apps.map((app) => toAppHealth(app, rows, to)),
    };
  }
}
