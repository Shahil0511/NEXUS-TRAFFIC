/**
 * ROUTES.users.* — the Users page: verified users, a user's profile, devices, days, one day, usual
 * activity hours and their combined timeline. The person-level leaves (PERSON_ROUTE_LEAVES) are
 * admin-only in the route table, and each answer is recorded in the person access log
 * (PersonAccessRecorder).
 */
import {
  type Environment,
  MAX_COUNT_RANGE_MS,
  RANGE_DURATIONS_MS,
  reportingDayWindow,
  type ResolvedTimeWindow,
  startOfReportingDay,
  USER_DAILY_APP_ROWS_LIMIT,
  USER_DAY_BLOCKS_LIMIT,
  USER_DAY_LOOKBACK_DAYS,
  USER_DAY_PAGES_LIMIT,
  USER_DAY_TOOLS_LIMIT,
  USER_DAY_VISITS_LIMIT,
  USER_DEVICES_LIMIT,
  type CursorPage,
  type UserActivityDto,
  type UserActivityQuery,
  type TimelineItemDto,
  type UserDailyActivityDto,
  type UserDailyQuery,
  type UserDayDetailDto,
  type UserDayQuery,
  type UserActivityPatternDto,
  type UserPatternQuery,
  weekdayDayCounts,
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
  mapUserActivityPattern,
  mapUserDayDetail,
  mapUserDevice,
  mapUserProfile,
  mapUserSummary,
} from '../domain/mappers';
import { fillCountGaps } from '../domain/timeseries-gaps';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from '../domain/pagination';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { NotFoundError, ValidationError } from '../errors/app-error';
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

  /**
   * ONE IST calendar day of one person (`query.day`): the day's facts and per-app split, its
   * activity blocks with time in app, its pages and features in first-use order, and its visits
   * (newest first). The global range does not apply; app and env do. 400 for a day in the future
   * or more than USER_DAY_LOOKBACK_DAYS back. A day without activity is an empty answer (200), and
   * it is STILL recorded: the email for the access-log row is looked up over a wider window
   * (personEmailLookupFilter), because "nothing that day" is a fact about the person too.
   * At most 3 statements run at once: wave 1 (day rows, blocks, pages); wave 2 (tools, visits)
   * only when the day has activity.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDailyActivity
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDayBlocks
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDayPages
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserDayTools
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listSessions
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   */
  async day(userKey: string, query: UserDayQuery, viewer: Viewer): Promise<UserDayDetailDto> {
    const now = this.clock.now();
    const window = oneDayWindow(query.day, now);
    const appId = await this.appSlugs.resolve(query.app);
    const environments = environmentsOf(query.env);
    const filter = currentFilter(window, appId, environments);
    const key = userKeyFromHex(userKey);

    const [days, blocks, pages] = await Promise.all([
      this.webEvents.listUserDailyActivity(key, filter),
      this.webEvents.listUserDayBlocks(key, filter, USER_DAY_BLOCKS_LIMIT),
      this.webEvents.listUserDayPages(key, filter, USER_DAY_PAGES_LIMIT),
    ]);
    const [tools, visits] =
      days.length === 0
        ? [[], []]
        : await Promise.all([
            this.webEvents.listUserDayTools(key, filter, USER_DAY_TOOLS_LIMIT),
            this.webEvents.listSessions(filter, {
              userKey: key,
              limit: USER_DAY_VISITS_LIMIT,
              offset: 0,
            }),
          ]);
    const body = mapUserDayDetail(
      { days, blocks, pages, tools, visits },
      toTimeWindowDto(window),
      query.day,
      now,
    );
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_day',
      filter,
      emailLookup: personEmailLookupFilter(window, now, appId, environments),
    });
    return body;
  }

  /**
   * The weekday × hour grid (IST) of one person's recorded activity over the last 7 or 30 days
   * (`query.range`, its own control; app and env apply, the global range does not). The window is
   * widened to WHOLE IST days (wholeReportingDays, so at most 31 days) and echoed widened; a cell
   * counts the calendar days with activity in that weekday-hour, read against `weekdayDays`
   * (weekdayDayCounts: the days of each weekday in the window). ONE statement. An empty window is
   * a 200 with no cells and is STILL recorded (`person_pattern`, email looked up over
   * personEmailLookupFilter).
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUserActivityPattern
   * @see ./person-access.recorder.ts PersonAccessRecorder.record
   */
  async pattern(
    userKey: string,
    query: UserPatternQuery,
    viewer: Viewer,
  ): Promise<UserActivityPatternDto> {
    const now = this.clock.now();
    const asked = resolveQueryWindow({ range: query.range }, now, MAX_COUNT_RANGE_MS);
    const window = { ...asked, ...wholeReportingDays(asked) };
    const appId = await this.appSlugs.resolve(query.app);
    const environments = environmentsOf(query.env);
    const filter = currentFilter(window, appId, environments);
    const key = userKeyFromHex(userKey);

    const rows = await this.webEvents.listUserActivityPattern(key, filter);
    const body = mapUserActivityPattern(rows, toTimeWindowDto(window), weekdayDayCounts(window));
    await this.personAccess.record({
      viewer,
      subjectUserKey: key,
      surface: 'person_pattern',
      filter,
      emailLookup: personEmailLookupFilter(window, now, appId, environments),
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

/**
 * The resolved window of ONE IST day (`YYYY-MM-DD`), refused with a 400 when the day is after
 * today or more than USER_DAY_LOOKBACK_DAYS before it (older raw data is gone anyway).
 */
function oneDayWindow(day: string, now: Date): ResolvedTimeWindow {
  const { from, to } = reportingDayWindow(day);
  assertDayInLookback(from, now);
  return resolveQueryWindow(
    { range: 'custom', from: from.toISOString(), to: to.toISOString() },
    now,
    RANGE_DURATIONS_MS.today,
  );
}

/** 400 VALIDATION_ERROR unless the day starting at `dayStart` lies in [today − lookback, today]. */
function assertDayInLookback(dayStart: Date, now: Date): void {
  const today = startOfReportingDay(now).getTime();
  const earliest = today - USER_DAY_LOOKBACK_DAYS * DAY_MS;
  if (dayStart.getTime() > today) throw dayRefused('day is in the future');
  if (dayStart.getTime() < earliest) {
    throw dayRefused(`day is more than ${USER_DAY_LOOKBACK_DAYS} days back`);
  }
}

/** The 400 of a refused `day`, pointing at the `day` field like a schema error. */
function dayRefused(message: string): ValidationError {
  return new ValidationError(message, [{ path: 'day', message }]);
}

/**
 * Where a person read whose own window can be empty (the one-day view, usual activity hours) looks
 * up the person's email for its access-log row: the read's window plus the last MAX_COUNT_RANGE_MS
 * before now, same app and environments. WHY: the window alone finds no email when it was empty
 * (and then nothing would be recorded); the recent window alone misses a day older than it. The
 * lookup is one newest-first probe per table.
 */
function personEmailLookupFilter(
  window: ResolvedTimeWindow,
  now: Date,
  appId: string | undefined,
  environments: readonly Environment[] | null,
): TrafficFilter {
  return {
    from: new Date(Math.min(window.from.getTime(), now.getTime() - MAX_COUNT_RANGE_MS)),
    to: new Date(Math.max(window.to.getTime(), now.getTime())),
    appId,
    environments,
  };
}
