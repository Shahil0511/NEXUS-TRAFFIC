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
  mapErrorCodeCount,
  mapRequestSample,
  mapStatusCount,
  mapTimeseriesPoint,
  mapUserUsage,
} from '../domain/mappers';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from '../domain/pagination';
import { fillTimeseriesGaps } from '../domain/timeseries-gaps';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { environmentsOf, type FailureFilter } from '../domain/filters';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import type { PersonAccessRecorder } from './person-access.recorder';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the Errors queries (window → app id → repository → mappers). */
export class ErrorService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
    private readonly personAccess: PersonAccessRecorder,
  ) {}

  /**
   * Totals (4xx / 5xx), failures per status, the gap-filled series, the top failing endpoints, the
   * users hit and the most frequent error codes, optionally of ONE route (`endpointId`), ONE user
   * (`userKey`) and/or ONE app error code (`errorCode`) — so the numbers above the list describe the
   * same requests as the list.
   * The top endpoints carry latency percentiles → capped at MAX_PERCENTILE_RANGE_MS. Narrowed to one
   * user it is a person-level read (admin-only in the route table), recorded as `person_failures`.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.summarizeErrors
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   */
  async summary(query: ErrorSummaryQuery, viewer: Viewer): Promise<ErrorSummaryDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter: FailureFilter = {
      ...currentFilter(window, await this.appSlugs.resolve(query.app), environmentsOf(query.env)),
      endpointId: query.endpointId,
      userKey: query.userKey === undefined ? undefined : userKeyFromHex(query.userKey),
      errorCode: query.errorCode,
    };

    const rows = await this.requests.summarizeErrors(filter, window.grain);
    await this.recordPersonRead(viewer, filter);
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
      usersAffected: rows.usersAffected,
      topAffectedUsers: rows.topAffectedUsers.map(mapUserUsage),
      byErrorCode: rows.byErrorCode.map(mapErrorCodeCount),
    };
  }

  /**
   * Failed requests newest first, keyset-paged on (occurred_at, event_id) — stable under inserts.
   * Counts only → capped at MAX_COUNT_RANGE_MS. Rows are role-masked (IP admin-only). Narrowed to
   * one user: admin-only, recorded as `person_failures` (coalesced with the summary's row).
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listFailures
   */
  async list(query: ErrorListQuery, viewer: Viewer): Promise<CursorPage<FailedRequestDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const after = parseKeysetCursor(query.cursor);

    const filter: FailureFilter = {
      ...currentFilter(window, appId, environmentsOf(query.env)),
      endpointId: query.endpointId,
      userKey: query.userKey === undefined ? undefined : userKeyFromHex(query.userKey),
      errorCode: query.errorCode,
    };

    const rows = await this.requests.listFailures(filter, {
      statusClass: query.statusClass,
      after,
      limit: pageFetchSize(query.limit),
    });
    await this.recordPersonRead(viewer, filter);
    return toCursorPage(
      rows,
      query.limit,
      (row) => mapRequestSample(row, viewer),
      (last) => encodeKeysetCursor(last.occurred_at_key, last.event_id),
    );
  }

  /** A read narrowed to one user is recorded in the person access log; the others are not. */
  private async recordPersonRead(viewer: Viewer, filter: FailureFilter): Promise<void> {
    if (!filter.userKey) return;
    await this.personAccess.record({
      viewer,
      subjectUserKey: filter.userKey,
      surface: 'person_failures',
      filter,
    });
  }
}
