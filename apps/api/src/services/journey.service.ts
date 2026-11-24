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

import { environmentsOf, type TrafficFilter } from '../domain/filters';
import { decodeOffsetCursor, encodeOffsetCursor } from '../db/sql';
import { mapSessionEvent, mapSessionSummary, mapTopPath } from '../domain/mappers';
import { pageFetchSize, toCursorPage } from '../domain/pagination';
import { interleaveByTime } from '../domain/session-replay';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { ForbiddenError, NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import type { PersonAccessRecorder } from './person-access.recorder';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

/** The 403 message for a non-admin opening a verified person's visit (no person detail in it). */
const VERIFIED_VISIT_ADMIN_ONLY = "Only admins can open the steps of a signed-in person's visit";

/** WHY: orchestrates the Journeys queries (window → app id → repository → domain → mappers). */
export class JourneyService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
    private readonly personAccess: PersonAccessRecorder,
  ) {}

  /**
   * Sessions most recently active first, optionally only those of one user, offset-cursor paged.
   * Counts only → MAX_COUNT_RANGE_MS. Rows are role-masked (IP admin-only). Narrowed to one user
   * it is a person-level read (admin-only in the route table) and recorded as `person_visits`.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listSessions
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   */
  async sessions(query: SessionListQuery, viewer: Viewer): Promise<CursorPage<SessionSummaryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const offset = decodeOffsetCursor(query.cursor);
    const userKey = query.userKey === undefined ? undefined : userKeyFromHex(query.userKey);

    const rows = await this.webEvents.listSessions(filter, {
      userKey,
      limit: pageFetchSize(query.limit),
      offset,
    });
    const page = toCursorPage(
      rows,
      query.limit,
      (row) => mapSessionSummary(row, viewer),
      () => encodeOffsetCursor(offset + query.limit),
    );
    if (userKey) {
      await this.personAccess.record({
        viewer,
        subjectUserKey: userKey,
        surface: 'person_visits',
        filter,
      });
    }
    return page;
  }

  /**
   * One session replay ("Visit steps"): header + browser events in (seq, occurred_at, event_id)
   * order with the correlated API calls interleaved by time. The app comes from the PATH (an `app`
   * query value is ignored). 404 when the app is unknown or the session has no events in the window.
   * A visit of a VERIFIED person (summary user_key set) is a person-level read: 403 for a non-admin,
   * recorded as `person_visit_steps` for an admin. Anonymous and claimed-only visits stay open to
   * every viewer. WHY here and not in the route table: whether the visit is a person's depends on
   * the data, so the route stays `...dashboard`. Whether it is verified does NOT depend on the
   * window the viewer picked (verifiedSubjectOf).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getSession
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   * @see ../../../../ai-context/decisions/0017-person-daily-depth.md
   */
  async session(
    app: string,
    sessionId: string,
    query: SessionQuery,
    viewer: Viewer,
  ): Promise<SessionDetailDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.resolveApp(app);

    const filter = currentFilter(window, appId, environmentsOf(query.env));
    const rows = await this.webEvents.getSession(appId, sessionId, filter);
    if (!rows) throw new NotFoundError('No events for this session in the selected window');
    const subject = await this.verifiedSubjectOf(appId, sessionId, rows.summary.user_key, filter);
    if (subject) {
      if (!viewer.isAdmin) throw new ForbiddenError(VERIFIED_VISIT_ADMIN_ONLY);
      await this.personAccess.record({
        viewer,
        subjectUserKey: subject.userKey,
        surface: 'person_visit_steps',
        filter: subject.filter,
      });
    }
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
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );

    const rows = await this.webEvents.listTopPaths(filter, query.limit);
    return { window: toTimeWindowDto(window), items: rows.map(mapTopPath) };
  }

  /**
   * The verified person a visit belongs to, and the window to name them in; null for an anonymous
   * or claimed-only visit. The summary's user_key covers only the viewer's window, so when it is
   * null the session is probed again over that window widened by MAX_COUNT_RANGE_MS on each side
   * (a visit is one tab's run of activity, far shorter than that). The environment stays the
   * viewer's: every event of one tab carries the same one. WHY: a narrow custom range over the
   * steps before sign-in would otherwise skip the admin-only guard and the access-log row.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.findSessionUserKey
   */
  private async verifiedSubjectOf(
    appId: string,
    sessionId: string,
    summaryUserKey: Buffer | null,
    filter: TrafficFilter,
  ): Promise<{ userKey: Buffer; filter: TrafficFilter } | null> {
    if (summaryUserKey !== null) return { userKey: summaryUserKey, filter };
    const widened: TrafficFilter = {
      ...filter,
      from: new Date(filter.from.getTime() - MAX_COUNT_RANGE_MS),
      to: new Date(filter.to.getTime() + MAX_COUNT_RANGE_MS),
    };
    const userKey = await this.webEvents.findSessionUserKey(appId, sessionId, widened);
    return userKey === null ? null : { userKey, filter: widened };
  }

  /** The path's app slug → internal id (an unknown slug is a 404 from the resolver). */
  private async resolveApp(app: string): Promise<string> {
    const appId = await this.appSlugs.resolve(app);
    if (appId === undefined) throw new NotFoundError(`Unknown app "${app}"`);
    return appId;
  }
}
