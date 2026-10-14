/**
 * ROUTES.errors.* — the Errors page: failure totals and chart, and the failed-request list.
 */
import {
  MAX_COUNT_RANGE_MS,
  MAX_PERCENTILE_RANGE_MS,
  type CursorPage,
  type ErrorListQuery,
  type ErrorSummaryDto,
  type ErrorSummaryQuery,
  type FailedRequestDto,
} from '@nexus/shared';

import { encodeKeysetCursor } from '../db/sql';
import {
  mapEndpointStats,
  mapRequestSample,
  mapStatusCount,
  mapTimeseriesPoint,
} from '../domain/mappers';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from '../domain/pagination';
import { fillTimeseriesGaps } from '../domain/timeseries-gaps';
import type { Viewer } from '../domain/viewer';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the Errors queries (window → app id → repository → mappers). */
export class ErrorService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * Totals (4xx / 5xx), failures per status, the gap-filled series and the top failing endpoints,
   * optionally of ONE route (`endpointId`, the Errors page opened from a route) — so the numbers
   * above the list describe the same requests as the list.
   * The top endpoints carry latency percentiles → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeErrors
   */
  async summary(query: ErrorSummaryQuery): Promise<ErrorSummaryDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = {
      ...currentFilter(window, await this.appSlugs.resolve(query.app)),
      endpointId: query.endpointId,
    };

    const rows = await this.requests.summarizeErrors(filter, window.grain);
    return {
      window: toTimeWindowDto(window),
      total: rows.totals.total,
      errors4xx: rows.totals.errors_4xx,
      errors5xx: rows.totals.errors_5xx,
      byStatus: rows.byStatus.map(mapStatusCount),
      timeseries: fillTimeseriesGaps(
        rows.timeseries.map((row) => mapTimeseriesPoint(row)),
        window,
      ),
      topEndpoints: rows.topEndpoints.map(mapEndpointStats),
    };
  }

  /**
   * Failed requests newest first, keyset-paged on (occurred_at, event_id) — stable under inserts.
   * Counts only → capped at MAX_COUNT_RANGE_MS. Rows are role-masked (IP admin-only).
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listFailures
   */
  async list(query: ErrorListQuery, viewer: Viewer): Promise<CursorPage<FailedRequestDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const after = parseKeysetCursor(query.cursor);

    const rows = await this.requests.listFailures(
      { ...currentFilter(window, appId), endpointId: query.endpointId },
      { statusClass: query.statusClass, after, limit: pageFetchSize(query.limit) },
    );
    return toCursorPage(
      rows,
      query.limit,
      (row) => mapRequestSample(row, viewer),
      (last) => encodeKeysetCursor(last.occurred_at_key, last.event_id),
    );
  }
}
