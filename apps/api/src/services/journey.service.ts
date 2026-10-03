/**
 * ROUTES.journeys.* — the Journeys page: session list, session replay and top 3-step paths.
 */
import {
  MAX_COUNT_RANGE_MS,
  MAX_PERCENTILE_RANGE_MS,
  type CursorPage,
  type SessionDetailDto,
  type SessionListQuery,
  type SessionQuery,
  type SessionSummaryDto,
  type TopPathDto,
  type TopPathsQuery,
  type WindowedListDto,
} from '@nexus/shared';

import { decodeOffsetCursor, encodeOffsetCursor } from '../db/sql';
import { mapSessionEvent, mapSessionSummary, mapTopPath } from '../domain/mappers';
import { pageFetchSize, toCursorPage } from '../domain/pagination';
import { interleaveByTime } from '../domain/session-replay';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** WHY: orchestrates the Journeys queries (window → app id → repository → domain → mappers). */
export class JourneyService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * Sessions most recently active first, optionally only those of one user, offset-cursor paged.
   * Counts only → MAX_COUNT_RANGE_MS. Rows are role-masked (IP admin-only).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listSessions
   */
  async sessions(query: SessionListQuery, viewer: Viewer): Promise<CursorPage<SessionSummaryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
    const offset = decodeOffsetCursor(query.cursor);

    const rows = await this.webEvents.listSessions(filter, {
      userKey: query.userKey === undefined ? undefined : userKeyFromHex(query.userKey),
      limit: pageFetchSize(query.limit),
      offset,
    });
    return toCursorPage(
      rows,
      query.limit,
      (row) => mapSessionSummary(row, viewer),
      () => encodeOffsetCursor(offset + query.limit),
    );
  }

  /**
   * One session replay: header + browser events in (seq, occurred_at, event_id) order with the
   * correlated API calls interleaved by time. The app comes from the PATH (an `app` query value is
   * ignored). 404 when the app is unknown or the session has no events in the window.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getSession
   */
  async session(
    app: string,
    sessionId: string,
    query: SessionQuery,
    viewer: Viewer,
  ): Promise<SessionDetailDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.resolveApp(app);

    const rows = await this.webEvents.getSession(appId, sessionId, currentFilter(window, appId));
    if (!rows) throw new NotFoundError('No events for this session in the selected window');
    return {
      summary: mapSessionSummary(rows.summary, viewer),
      events: interleaveByTime(rows.browserEvents, rows.apiCalls).map(mapSessionEvent),
    };
  }

  /**
   * The most common 3-page sequences. Window functions over every page view of the window, so the
   * heavier cap applies → MAX_PERCENTILE_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listTopPaths
   */
  async topPaths(query: TopPathsQuery): Promise<WindowedListDto<TopPathDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_PERCENTILE_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.listTopPaths(filter, query.limit);
    return { window: toTimeWindowDto(window), items: rows.map(mapTopPath) };
  }

  /** The path's app slug → internal id (an unknown slug is a 404 from the resolver). */
  private async resolveApp(app: string): Promise<string> {
    const appId = await this.appSlugs.resolve(app);
    if (appId === undefined) throw new NotFoundError(`Unknown app "${app}"`);
    return appId;
  }
}
