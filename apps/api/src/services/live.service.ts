/**
 * ROUTES.live.snapshot — the Live page's starting point, read from the DATABASE: the last
 * LIVE_SNAPSHOT_MINUTES one-minute ticks plus the newest LIVE_SNAPSHOT_RECENT_EVENTS events.
 * After it loads, the page applies `traffic:tick` / `traffic:events` from Socket.io on top.
 *
 * ROUTES.live.online — who is active RIGHT NOW (the last ACTIVE_USER_WINDOW_MS): people per app
 * and the verified people with what they did last. REST only (no Socket.io event carries it).
 */
import {
  ACTIVE_USER_WINDOW_MS,
  LIVE_SNAPSHOT_RECENT_EVENTS,
  liveScopeKey,
  type LiveOnlineQuery,
  type LiveSnapshotDto,
  type LiveSnapshotQuery,
  type OnlineNowDto,
} from '@nexus/shared';

import type { TrafficFilter } from '../domain/filters';
import { liveSnapshotWindow, toLiveTicks } from '../domain/live-ticks';
import { mapLiveEvent, mapOnlineApp, mapOnlineUser } from '../domain/mappers';
import type { Viewer } from '../domain/viewer';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import {
  ONLINE_USERS_LIMIT,
  type WebEventQueryRepository,
} from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';

/**
 * WHY: orchestrates the four snapshot queries (tick shaping lives in domain/live-ticks.ts) and the
 * two "who is online" queries.
 */
export class LiveService {
  constructor(
    private readonly requests: ApiRequestQueryRepository,
    private readonly webEvents: WebEventQueryRepository,
    private readonly appSlugs: AppSlugResolver,
    private readonly clock: Clock,
  ) {}

  /**
   * Minute ticks (API counters + page views / tool uses, gap-filled) and recent events, role-masked.
   * @see ../repositories/api-request-query.repository.ts ApiRequestQueryRepository.timeseries
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.activityTimeseries
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listRecentEvents
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countActiveUsers
   */
  async snapshot(query: LiveSnapshotQuery, viewer: Viewer): Promise<LiveSnapshotDto> {
    const now = this.clock.now();
    const appId = await this.appSlugs.resolve(query.app);
    const window = liveSnapshotWindow(now);
    const filter: TrafficFilter = { from: window.from, to: window.to, appId };
    const activeWindow: TrafficFilter = {
      from: new Date(now.getTime() - ACTIVE_USER_WINDOW_MS),
      to: now,
      appId,
    };

    const [traffic, activity, recent, activeUsersNow] = await Promise.all([
      this.requests.timeseries(filter, window.grain),
      this.webEvents.activityTimeseries(filter, window.grain),
      this.webEvents.listRecentEvents(filter, LIVE_SNAPSHOT_RECENT_EVENTS),
      this.webEvents.countActiveUsers(activeWindow),
    ]);

    return {
      ticks: toLiveTicks({
        scope: liveScopeKey(query.app ? { app: query.app } : {}),
        window,
        traffic,
        activity,
        activeUsersNow,
      }),
      recent: recent.map((row) => mapLiveEvent(row, viewer)),
    };
  }

  /**
   * People active in the last ACTIVE_USER_WINDOW_MS: per app (verified + anonymous) and the
   * verified people themselves (newest first, at most ONLINE_USERS_LIMIT). Every query is bounded
   * by that window on every table; `app` / `userKey` narrow it. No IP is ever read.
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.countOnlineByApp
   * @see ../repositories/web-event-query.repository.ts WebEventQueryRepository.listOnlineUsers
   */
  async online(query: LiveOnlineQuery): Promise<OnlineNowDto> {
    const now = this.clock.now();
    const filter: TrafficFilter = {
      from: new Date(now.getTime() - ACTIVE_USER_WINDOW_MS),
      to: now,
      appId: await this.appSlugs.resolve(query.app),
      userKey: query.userKey === undefined ? undefined : userKeyFromHex(query.userKey),
    };
    const [apps, users] = await Promise.all([
      this.webEvents.countOnlineByApp(filter),
      this.webEvents.listOnlineUsers(filter, ONLINE_USERS_LIMIT),
    ]);
    return {
      asOf: now.toISOString(),
      windowMs: ACTIVE_USER_WINDOW_MS,
      apps: apps.map(mapOnlineApp),
      users: users.map(mapOnlineUser),
    };
  }
}
