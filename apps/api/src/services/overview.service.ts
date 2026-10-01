/**
 * ROUTES.overview.* — the Overview page: KPI cards with deltas and the traffic chart.
 */
import {
  ACTIVE_USER_WINDOW_MS,
  MAX_PERCENTILE_RANGE_MS,
  type OverviewSummaryDto,
  type OverviewSummaryQuery,
  type OverviewTimeseriesDto,
  type OverviewTimeseriesQuery,
} from '@nexus/shared';

import { computeMetric } from '../domain/compute-deltas';
import type { TrafficFilter } from '../domain/filters';
import { mapTimeseriesPoint } from '../domain/mappers';
import { percentOf } from '../domain/numbers';
import type { PageViewBucketRow } from '../domain/rows';
import { fillTimeseriesGaps, withPageViews } from '../domain/timeseries-gaps';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, previousFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: page views keyed like the chart points (ISO bucket) so they can be merged in one pass. */
function pageViewsByBucket(rows: readonly PageViewBucketRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.bucket.toISOString(), row.page_views]));
}

/** WHY: orchestrates the Overview queries; every number is computed in SQL or in domain/. */
export class OverviewService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * KPIs over the window, each compared with the previous equal-length window, plus "active users
   * now" (last ACTIVE_USER_WINDOW_MS, not window-bound). p95 → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeTraffic
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.summarizePageViews
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countActiveUsers
   */
  async summary(query: OverviewSummaryQuery): Promise<OverviewSummaryDto> {
    const now = this.clock.now();
    const window = resolveQueryWindow(query, now, MAX_PERCENTILE_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const current = currentFilter(window, appId);
    const previous = previousFilter(window, appId);
    const activeWindow: TrafficFilter = {
      from: new Date(now.getTime() - ACTIVE_USER_WINDOW_MS),
      to: now,
      appId,
    };

    const [traffic, previousTraffic, pageViews, previousPageViews, activeUsersNow] =
      await Promise.all([
        this.requests.summarizeTraffic(current),
        this.requests.summarizeTraffic(previous),
        this.webEvents.summarizePageViews(current),
        this.webEvents.summarizePageViews(previous),
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
      identifiedUsers: computeMetric(traffic.identified_users, previousTraffic.identified_users),
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
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

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
}
