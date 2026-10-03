/**
 * ROUTES.live.snapshot — the Live page's starting point, read from the DATABASE: the last
 * LIVE_SNAPSHOT_MINUTES one-minute ticks plus the newest LIVE_SNAPSHOT_RECENT_EVENTS events.
 * After it loads, the page applies `traffic:tick` / `traffic:events` from Socket.io on top.
 */
import {
  ACTIVE_USER_WINDOW_MS,
  LIVE_SNAPSHOT_RECENT_EVENTS,
  liveScopeKey,
  type LiveSnapshotDto,
  type LiveSnapshotQuery,
} from '@nexus/shared';

import type { TrafficFilter } from '../domain/filters';
import { liveSnapshotWindow, toLiveTicks } from '../domain/live-ticks';
import { mapLiveEvent } from '../domain/mappers';
import type { Viewer } from '../domain/viewer';
import type { Clock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';

/** WHY: orchestrates the four snapshot queries; tick shaping lives in domain/live-ticks.ts. */
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
}
