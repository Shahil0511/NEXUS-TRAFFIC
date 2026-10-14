/**
 * ROUTES.users.* — the Users page: verified users, a user's profile and their combined timeline.
 */
import {
  MAX_COUNT_RANGE_MS,
  type CursorPage,
  type UserActivityDto,
  type UserActivityQuery,
  type TimelineItemDto,
  type UserListQuery,
  type UserProfileDto,
  type UserProfileQuery,
  type UserSearchBody,
  type UserSummaryDto,
  type UserTimelineQuery,
} from '@nexus/shared';

import { decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '../db/sql';
import { mapTimelineItem, mapUserProfile, mapUserSummary } from '../domain/mappers';
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
   * Header numbers, top tools, pages and API routes, activity per app and countries of one user.
   * 404 when the user has no activity in the window.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserProfile
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.listUserTopEndpoints
   */
  async profile(userKey: string, query: UserProfileQuery): Promise<UserProfileDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
    const key = userKeyFromHex(userKey);

    const [rows, topEndpoints] = await Promise.all([
      this.webEvents.getUserProfile(key, filter),
      this.requests.listUserTopEndpoints(key, filter, PROFILE_TOP_LIMIT),
    ]);
    if (!rows) throw new NotFoundError('No activity for this user in the selected window');
    return mapUserProfile(rows, topEndpoints);
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
    const filter = currentFilter(window, appId);
    const endingAt = (days: number) => ({
      from: new Date(window.to.getTime() - days * DAY_MS),
      to: window.to,
      appId,
    });

    const [daily, wau, mau] = await Promise.all([
      this.webEvents.listDailyUsers(filter),
      this.webEvents.countIdentifiedUsers(endingAt(WAU_DAYS)),
      this.webEvents.countIdentifiedUsers(endingAt(MAU_DAYS)),
    ]);
    const counts = new Map(daily.map((row) => [row.day.toISOString(), row.users]));
    return {
      window: toTimeWindowDto(window),
      points: fillCountGaps(counts, { from: window.from, to: window.to, grain: 'day' }).map(
        (point) => ({ day: point.bucket, users: point.count }),
      ),
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
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
    const after = parseKeysetCursor(query.cursor);

    const rows = await this.webEvents.listUserTimeline(userKeyFromHex(userKey), filter, {
      after,
      limit: pageFetchSize(query.limit),
    });
    return toCursorPage(
      rows,
      query.limit,
      (row) => mapTimelineItem(row, viewer),
      (last) => encodeKeysetCursor(last.occurred_at_key, last.event_id),
    );
  }

  /** The list + search body: window → app id → one page of users. */
  private async listMatching(
    query: UserListQuery,
    search: string | undefined,
  ): Promise<CursorPage<UserSummaryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
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
