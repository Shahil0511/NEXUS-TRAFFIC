/**
 * ROUTES.endpoints.* — the API Routes page: per-route stats table and the route detail page.
 */
import {
  MAX_PERCENTILE_RANGE_MS,
  type CursorPage,
  type EndpointDetailDto,
  type EndpointDetailQuery,
  type EndpointListQuery,
  type EndpointStatsDto,
} from '@nexus/shared';

import { decodeOffsetCursor, encodeOffsetCursor } from '../db/sql';
import {
  mapEndpointStats,
  mapRequestSample,
  mapStatusCount,
  mapTimeseriesPoint,
  mapUserUsage,
} from '../domain/mappers';
import { pageFetchSize, toCursorPage } from '../domain/pagination';
import { fillTimeseriesGaps } from '../domain/timeseries-gaps';
import type { Viewer } from '../domain/viewer';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the Routes queries (window → app id → repository → mappers). */
export class EndpointService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * One row per (app, method, route template), sorted by a whitelisted key, offset-cursor paged
   * (keyset is meaningless over GROUP BY results). Percentiles → capped at MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listEndpointStats
   */
  async list(query: EndpointListQuery): Promise<CursorPage<EndpointStatsDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
    const offset = decodeOffsetCursor(query.cursor);

    const rows = await this.requests.listEndpointStats(filter, {
      sort: query.sort,
      dir: query.dir,
      search: query.search,
      limit: pageFetchSize(query.limit),
      offset,
    });
    return toCursorPage(rows, query.limit, mapEndpointStats, () =>
      encodeOffsetCursor(offset + query.limit),
    );
  }

  /**
   * Stats, gap-filled chart, status breakdown, slowest calls and top callers of one endpoint_id.
   * 404 when the endpoint has no traffic in the window. Samples are role-masked (IP admin-only).
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.getEndpointDetail
   */
  async detail(
    endpointId: string,
    query: EndpointDetailQuery,
    viewer: Viewer,
  ): Promise<EndpointDetailDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.requests.getEndpointDetail(endpointId, filter, window.grain);
    if (!rows) throw new NotFoundError('No traffic for this endpoint in the selected window');

    return {
      window: toTimeWindowDto(window),
      endpoint: mapEndpointStats(rows.stats),
      timeseries: fillTimeseriesGaps(
        rows.timeseries.map((row) => mapTimeseriesPoint(row)),
        window,
      ),
      statusBreakdown: rows.statusBreakdown.map(mapStatusCount),
      slowest: rows.slowest.map((row) => mapRequestSample(row, viewer)),
      uniqueUsers: rows.uniqueUsers,
      topUsers: rows.topUsers.map(mapUserUsage),
    };
  }
}
