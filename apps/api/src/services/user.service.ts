/**
 * ROUTES.users.* — the Users page: verified users, a user's profile, devices, days and their
 * combined timeline. The four person-level leaves (PERSON_ROUTE_LEAVES) are admin-only in the
 * route table, and each answer is recorded in the person access log (PersonAccessRecorder).
 */
import {
  MAX_COUNT_RANGE_MS,
  USER_DAILY_APP_ROWS_LIMIT,
  USER_DEVICES_LIMIT,
  type CursorPage,
  type UserActivityDto,
  type UserActivityQuery,
  type TimelineItemDto,
  type UserDailyActivityDto,
  type UserDailyQuery,
  type UserDevicesDto,
  type UserDevicesQuery,
  type UserListQuery,
  type UserProfileDto,
  type UserProfileQuery,
  type UserSearchBody,
  type UserSummaryDto,
  type UserTimelineQuery,
  wholeReportingDays,
} from '@nexus/shared';

import { environmentsOf, type TrafficFilter } from '../domain/filters';
import { decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '../db/sql';
import {
  dropTruncatedOldestDay,
  foldUserDays,
  mapTimelineItem,
  mapUserDevice,
  mapUserProfile,
  mapUserSummary,
} from '../domain/mappers';
import { fillCountGaps } from '../domain/timeseries-gaps';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from '../domain/pagination';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import {
  PROFILE_TOP_LIMIT,
  type WebEventQueryRepository,
} from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import type { PersonAccessRecorder } from './person-access.recorder';
import { currentFilter, resolveQueryWindow, toTimeWindowDto } from './query-window';

const DAY_MS = 86_400_000;
/** "Weekly" / "monthly" active users: distinct users of the last 7 / 30 days. */
const WAU_DAYS = 7;
const MAU_DAYS = 30;

/**
 * WHY: orchestrates the Users queries (window → app id → repository → mappers). A user is ALWAYS
 * addressed by the stored `user_key` (64-char hex in the URL), never by email.
 */
export class UserService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly requests: ApiRequestQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
    private readonly personAccess: PersonAccessRecorder,
  ) {}

  /**
   * Verified users (sso_cookie / app_attested) over API calls + browser events, ordered by a
   * whitelisted key (default most recently seen), offset-cursor paged. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUsers
   */
  async list(query: UserListQuery): Promise<CursorPage<UserSummaryDto>> {
    return this.listMatching(query, undefined);
  }

  /**
   * Same list, narrowed to emails containing `search`. The search arrives in a POST body, never in
   * a URL (ADR 0006), so a typed email cannot end up in an access log.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUsers
   */
  async search(body: UserSearchBody): Promise<CursorPage<UserSummaryDto>> {
    return this.listMatching(body, body.search);
  }

  /**
   * Header numbers, top tools, pages and API routes, activity per app, countries and the latest
   * known browser facts (the identity card) of one user. 404 when the user has no activity in the
   * window (and then no access-log row).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserProfile
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserLatestContext
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listUserTopEndpoints
   */
  async profile(userKey: string, query: UserProfileQuery, viewer: Viewer): Promise<UserProfileDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const key = userKeyFromHex(userKey);

    const [rows, topEndpoints, latest] = await Promise.all([
      this.webEvents.getUserProfile(key, filter),
      this.requests.listUserTopEndpoints(key, filter, PROFILE_TOP_LIMIT),
      this.webEvents.getUserLatestContext(key, filter),
    ]);
    if (!rows) throw new NotFoundError('No activity for this user in the selected window');
    const body = mapUserProfile(rows, topEndpoints, latest);
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_profile',
      filter,
    });
    return body;
  }

  /**
   * Distinct verified users per IST day over the window (DAU, gap-filled), plus the distinct users
   * of the 7 / 30 days ending at the window's end (WAU / MAU). Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listDailyUsers
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countIdentifiedUsers
   */
  async activity(query: UserActivityQuery): Promise<UserActivityDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const appId = await this.appSlugs.resolve(query.app);
    const filter = currentFilter(window, appId, environmentsOf(query.env));
    const endingAt = (days: number): TrafficFilter => ({
      from: new Date(window.to.getTime() - days * DAY_MS),
      to: window.to,
      appId,
      environments: filter.environments,
    });

    const [daily, wau, mau] = await Promise.all([
      this.webEvents.listDailyUsers(filter),
      this.webEvents.countIdentifiedUsers(endingAt(WAU_DAYS)),
      this.webEvents.countIdentifiedUsers(endingAt(MAU_DAYS)),
    ]);
    const counts = new Map(daily.map((row) => [row.day.toISOString(), row.users]));
    return {
      window: toTimeWindowDto(window),
      points: fillCountGaps(counts, { ...window, grain: 'day' }).map((point) => ({
        day: point.bucket,
        users: point.count,
      })),
      wau,
      mau,
    };
  }

  /**
   * Pages, tools and API calls of one user merged newest first, keyset-paged on
   * (occurred_at, event_id). Items are role-masked (IP admin-only).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserTimeline
   */
  async timeline(
    userKey: string,
    query: UserTimelineQuery,
    viewer: Viewer,
  ): Promise<CursorPage<TimelineItemDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const after = parseKeysetCursor(query.cursor);
    const key = userKeyFromHex(userKey);

    const rows = await this.webEvents.listUserTimeline(key, filter, {
      after,
      limit: pageFetchSize(query.limit),
    });
    const page = toCursorPage(
      rows,
      query.limit,
      (row) => mapTimelineItem(row, viewer),
      (last) => encodeKeysetCursor(last.occurred_at_key, last.event_id),
    );
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_timeline',
      filter,
    });
    return page;
  }

  /**
   * The (device type, browser, OS) combinations one user was seen on, most recently used first
   * (at most USER_DEVICES_LIMIT) — the Devices tab only (the identity card's latest facts come with
   * the profile, so opening the page does not record a Devices view). An empty list, not a 404,
   * when the user did nothing in the window (the profile answers the 404).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDevices
   */
  async devices(userKey: string, query: UserDevicesQuery, viewer: Viewer): Promise<UserDevicesDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const key = userKeyFromHex(userKey);

    const devices = await this.webEvents.listUserDevices(key, filter, USER_DEVICES_LIMIT);
    const body = { window: toTimeWindowDto(window), items: devices.map(mapUserDevice) };
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_devices',
      filter,
    });
    return body;
  }

  /**
   * One item per IST calendar day on which the user was active, newest first (idle days are left
   * out): first / last activity, tab-visible time and counts, plus the same facts per app
   * (`perApp`, in first-activity order). The repository answers one row per (day, app);
   * foldUserDays folds them, after dropTruncatedOldestDay drops a day cut by the row cap. The
   * window is widened to WHOLE IST days (wholeReportingDays) and echoed widened: a rolling range
   * (24h at 15:00) would otherwise cut its oldest day at 15:00 and report that cut as the day's
   * first activity. The day still running is flagged `inProgress`. Counts only →
   * MAX_COUNT_RANGE_MS (checked on the range asked for; widening adds at most one day).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDailyActivity
   */
  async daily(
    userKey: string,
    query: UserDailyQuery,
    viewer: Viewer,
  ): Promise<UserDailyActivityDto> {
    const now = this.clock.now();
    const asked = resolveQueryWindow(query, now, MAX_COUNT_RANGE_MS);
    const window = { ...asked, ...wholeReportingDays(asked) };
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const key = userKeyFromHex(userKey);

    const rows = await this.webEvents.listUserDailyActivity(key, filter);
    const body = {
      window: toTimeWindowDto(window),
      items: foldUserDays(dropTruncatedOldestDay(rows, USER_DAILY_APP_ROWS_LIMIT), now),
    };
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_daily',
      filter,
    });
    return body;
  }

  /** The list + search body: window → app id → one page of users. */
  private async listMatching(
    query: UserListQuery,
    search: string | undefined,
  ): Promise<CursorPage<UserSummaryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(
      window,
      await this.appSlugs.resolve(query.app),
      environmentsOf(query.env),
    );
    const offset = decodeOffsetCursor(query.cursor);

    const rows = await this.webEvents.listUsers(filter, {
      search,
      sort: query.sort,
      dir: query.dir,
      limit: pageFetchSize(query.limit),
      offset,
    });
    return toCursorPage(rows, query.limit, mapUserSummary, () =>
      encodeOffsetCursor(offset + query.limit),
    );
  }
}
