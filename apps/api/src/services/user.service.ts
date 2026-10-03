/**
 * ROUTES.users.* — the Users page: verified users, a user's profile and their combined timeline.
 */
import {
  MAX_COUNT_RANGE_MS,
  type CursorPage,
  type TimelineItemDto,
  type UserListQuery,
  type UserProfileDto,
  type UserProfileQuery,
  type UserSummaryDto,
  type UserTimelineQuery,
} from '@nexus/shared';

import { decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '../db/sql';
import { mapTimelineItem, mapUserProfile, mapUserSummary } from '../domain/mappers';
import { pageFetchSize, parseKeysetCursor, toCursorPage } from '../domain/pagination';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import { NotFoundError } from '../errors/app-error';
import type { Clock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { currentFilter, resolveQueryWindow } from './query-window';

/**
 * WHY: orchestrates the Users queries (window → app id → repository → mappers). A user is ALWAYS
 * addressed by the stored `user_key` (64-char hex in the URL), never by email.
 */
export class UserService {
  constructor(
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * Verified users (sso_cookie / app_attested) over API calls + browser events, most recently seen
   * first, optional email search, offset-cursor paged. Counts only → MAX_COUNT_RANGE_MS.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listUsers
   */
  async list(query: UserListQuery): Promise<CursorPage<UserSummaryDto>> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));
    const offset = decodeOffsetCursor(query.cursor);

    const rows = await this.webEvents.listUsers(filter, {
      search: query.search,
      limit: pageFetchSize(query.limit),
      offset,
    });
    return toCursorPage(rows, query.limit, mapUserSummary, () =>
      encodeOffsetCursor(offset + query.limit),
    );
  }

  /**
   * Header numbers, top tools, top pages and countries of one user. 404 when the user has no
   * activity in the window.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.getUserProfile
   */
  async profile(userKey: string, query: UserProfileQuery): Promise<UserProfileDto> {
    const window = resolveQueryWindow(query, this.clock.now(), MAX_COUNT_RANGE_MS);
    const filter = currentFilter(window, await this.appSlugs.resolve(query.app));

    const rows = await this.webEvents.getUserProfile(userKeyFromHex(userKey), filter);
    if (!rows) throw new NotFoundError('No activity for this user in the selected window');
    return mapUserProfile(rows);
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
}
