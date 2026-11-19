/**
 * ROUTES.overview.* — the Overview page (KPI cards with deltas, traffic chart) and the
 * Applications page (one row per registered app).
 */
import {
  ACTIVE_USER_WINDOW_MS,
  MAX_COUNT_RANGE_MS,
  MAX_PERCENTILE_RANGE_MS,
  RETURNING_DEVICE_LOOKBACK_MS,
  SERVER_BREAKDOWN_DIMENSION_VALUES,
  type AppTrafficDto,
  type BreakdownDimension,
  type BreakdownDto,
  type BreakdownOverviewQuery,
  type DeviceReturnDto,
  type DevicesOverviewQuery,
  type OverviewAppsQuery,
  type OverviewSummaryDto,
  type OverviewSummaryQuery,
  type OverviewTimeseriesDto,
  type OverviewTimeseriesQuery,
  type ServerBreakdownDimension,
  type WindowedListDto,
} from '@nexus/shared';

import { computeMetric } from '../domain/compute-deltas';
import { environmentsOf, type TrafficFilter } from '../domain/filters';
import { mapAppTraffic, mapBreakdownItem, mapTimeseriesPoint } from '../domain/mappers';
import { percentOf } from '../domain/numbers';
import type { BreakdownRow, PageViewBucketRow } from '../domain/rows';
import { fillTimeseriesGaps, withPageViews } from '../domain/timeseries-gaps';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppRepository } from '../repositories/app.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, previousFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: per-app rows keyed by app id so the four per-app queries merge in one pass. */
function byAppId<T extends { app_id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.app_id, row]));
}

/** Busiest first (API calls + page views), then by slug — silent apps sink to the bottom. */
function byActivityDesc(a: AppTrafficDto, b: AppTrafficDto): number {
  const volume = (row: AppTrafficDto) => (row.requests.value ?? 0) + (row.pageViews.value ?? 0);
  return volume(b) - volume(a) || a.app.localeCompare(b.app);
}

/**
 * WHY: narrows a dimension to the api_requests whitelist. breakdownOverviewQuerySchema already
 * refuses other dimensions for source=server; this keeps the type honest without a cast.
 */
function isServerBreakdownDimension(
  dimension: BreakdownDimension,
): dimension is ServerBreakdownDimension {
  return (SERVER_BREAKDOWN_DIMENSION_VALUES as readonly BreakdownDimension[]).includes(dimension);
}

/** WHY: page views keyed like the chart points (ISO bucket) so they can be merged in one pass. */
function pageViewsByBucket(rows: readonly PageViewBucketRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.bucket.toISOString(), row.page_views]));
}

/** WHY: orchestrates the Overview queries; every number is computed in SQL or in domain/. */
export class OverviewService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly webEvents: WebEventQueryRepository,
    private readonly registeredApps: AppRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * KPIs over the window, each compared with the previous equal-length window, plus "active users
   * now" (last ACTIVE_USER_WINDOW_MS, not window-bound). p95 → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeTraffic
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.summarizePageViews
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countActiveUsers
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countIdentifiedUsers
   */
  async summary(query: OverviewSummaryQuery): Promise<OverviewSummaryDto> {
    const now = this.clock.now();
    const window = resolveQueryWindow(query, now, MAX_PERCENTILE_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const environments = environmentsOf(query.env);
    const current = currentFilter(window, appId, environments);
    const previous = previousFilter(window, appId, environments);
    const activeWindow: TrafficFilter = {
      from: new Date(now.getTime() - ACTIVE_USER_WINDOW_MS),
      to: now,
      appId,
      environments,
    };

    const [
      traffic,
      previousTraffic,
      pageViews,
      previousPageViews,
      identifiedUsers,
      previousIdentifiedUsers,
      activeUsersNow,
    ] = await Promise.all([
      this.requests.summarizeTraffic(current),
      this.requests.summarizeTraffic(previous),
      this.webEvents.summarizePageViews(current),
      this.webEvents.summarizePageViews(previous),
      this.webEvents.countIdentifiedUsers(current),
      this.webEvents.countIdentifiedUsers(previous),
      this.webEvents.countActiveUsers(activeWindow),
    ]);

    return {
      window: toTimeWindowDto(window),
      requests: computeMetric(traffic.requests, previousTraffic.requests),
      errorRate: computeMetric(
        percentOf(traffic.errors, traffic.requests),
        percentOf(previousTraffic.errors, previousTraffic.requests),
      ),
      p95Ms: computeMetric(traffic.p95_ms, previousTraffic.p95_ms),
      pageViews: computeMetric(pageViews, previousPageViews),
      identifiedUsers: computeMetric(identifiedUsers, previousIdentifiedUsers),
      activeUsersNow,
    };
  }

  /**
   * Requests / 4xx / 5xx / p95 / page views per bucket, gap-filled so the chart is continuous.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.timeseries
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.pageViewTimeseries
   */
  async timeseries(query: OverviewTimeseriesQuery): Promise<OverviewTimeseriesDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );

    const [buckets, pageViewBuckets] = await Promise.all([
      this.requests.timeseries(filter, window.grain),
      this.webEvents.pageViewTimeseries(filter, window.grain),
    ]);

    const points = fillTimeseriesGaps(
      buckets.map((row) => mapTimeseriesPoint(row)),
      window,
    );
    return {
      window: toTimeWindowDto(window),
      points: withPageViews(points, pageViewsByBucket(pageViewBuckets)),
    };
  }

  /**
   * One row per REGISTERED app (busiest first; silent apps last with zeros), each KPI compared
   * with the previous window. `app` narrows the list to that one app (application detail page).
   * p95 → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeTrafficByApp
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.summarizeActivityByApp
   */
  async apps(query: OverviewAppsQuery): Promise<WindowedListDto<AppTrafficDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const environments = environmentsOf(query.env);
    const current = currentFilter(window, appId, environments);
    const previous = previousFilter(window, appId, environments);

    const [apps, traffic, previousTraffic, activity, previousActivity] = await Promise.all([
      this.registeredApps.list(),
      this.requests.summarizeTrafficByApp(current),
      this.requests.summarizeTrafficByApp(previous),
      this.webEvents.summarizeActivityByApp(current),
      this.webEvents.summarizeActivityByApp(previous),
    ]);

    const trafficOf = byAppId(traffic);
    const previousTrafficOf = byAppId(previousTraffic);
    const activityOf = byAppId(activity);
    const previousActivityOf = byAppId(previousActivity);
    const items = apps
      .filter((app) => appId === undefined || app.id === appId)
      .map((app) =>
        mapAppTraffic(app, {
          traffic: trafficOf.get(app.id),
          previousTraffic: previousTrafficOf.get(app.id),
          activity: activityOf.get(app.id),
          previousActivity: previousActivityOf.get(app.id),
        }),
      )
      .sort(byActivityDesc);
    return { window: toTimeWindowDto(window), items };
  }

  /**
   * Top `limit` values of one whitelisted dimension (browser, os, device, tz, lang, release,
   * environment …) of one source over the window, busiest first, with each value's share of ALL
   * the window's events. Browser: page views (page_time rows for `time_reason`); server: every API
   * call. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countByDimension
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.countByDimension
   */
  async breakdown(query: BreakdownOverviewQuery): Promise<BreakdownDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const filter = currentFilter(window, appId, environmentsOf(query.env));
    const rows = await this.countByDimension(query, filter);
    return {
      window: toTimeWindowDto(window),
      source: query.source,
      dimension: query.dimension,
      total: rows[0]?.total ?? 0,
      items: rows.map(mapBreakdownItem),
    };
  }

  /**
   * New vs returning devices (distinct anonymous_id on page views) over the window: returning =
   * also seen in the RETURNING_DEVICE_LOOKBACK_MS before the window. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countDeviceReturn
   */
  async devices(query: DevicesOverviewQuery): Promise<DeviceReturnDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const filter = currentFilter(window, appId, environmentsOf(query.env));
    const lookbackFrom = new Date(window.from.getTime() - RETURNING_DEVICE_LOOKBACK_MS);
    const row = await this.webEvents.countDeviceReturn(filter, lookbackFrom);
    return {
      window: toTimeWindowDto(window),
      lookbackFrom: lookbackFrom.toISOString(),
      devices: row.devices,
      newDevices: row.devices - row.returning_devices,
      returningDevices: row.returning_devices,
    };
  }

  /** Routes the breakdown to the table of its source (server dimensions are a subset). */
  private countByDimension(
    query: BreakdownOverviewQuery,
    filter: TrafficFilter,
  ): Promise<BreakdownRow[]> {
    if (query.source === 'browser') {
      return this.webEvents.countByDimension(query.dimension, filter, query.limit);
    }
    if (!isServerBreakdownDimension(query.dimension)) return Promise.resolve([]);
    return this.requests.countByDimension(query.dimension, filter, query.limit);
  }
}
