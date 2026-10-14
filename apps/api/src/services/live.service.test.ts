import {
  ACTIVE_USER_WINDOW_MS,
  LIVE_SNAPSHOT_MINUTES,
  LIVE_SNAPSHOT_RECENT_EVENTS,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  onlineUserRow,
  PLAIN_VIEWER,
  trafficBucketRow,
  USER_KEY,
  USER_KEY_HEX,
} from '../../test/fixtures/analytics-rows';
import { FakeAppSlugs, KNOWN_APP_ID } from '../../test/fixtures/fake-query-repositories';
import type { TrafficFilter } from '../domain/filters';
import type {
  ActivityBucketRow,
  LiveEventRow,
  OnlineAppRow,
  OnlineUserRow,
  TrafficBucketRow,
} from '../domain/rows';
import { NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import {
  ONLINE_USERS_LIMIT,
  type WebEventQueryRepository,
} from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { LiveService } from './live.service';

const NOW = new Date('2026-10-01T10:00:30.000Z');
const CURRENT_MINUTE = '2026-10-01T10:00:00.000Z';
const FIRST_MINUTE = '2026-10-01T09:01:00.000Z';

function liveEventRow(overrides: Partial<LiveEventRow> = {}): LiveEventRow {
  return {
    occurred_at: new Date('2026-10-01T10:00:20.000Z'),
    event_id: '66666666-6666-4666-8666-666666666666',
    kind: 'api',
    app_slug: 'ebo-sales',
    path: '/api/orders/42',
    method: 'GET',
    status_code: 500,
    duration_ms: 12.3456,
    tool: null,
    user_email: 'amit@libas.in',
    user_key: null,
    endpoint_id: null,
    session_id: null,
    ip: '203.0.113.7',
    geo_country: 'IN',
    geo_city: 'Mumbai',
    ...overrides,
  };
}

class FakeRequests implements Pick<ApiRequestQueryRepository, 'timeseries'> {
  calls: Array<{ filter: TrafficFilter; grain: string }> = [];
  rows: TrafficBucketRow[] = [];
  async timeseries(filter: TrafficFilter, grain: 'minute' | 'hour' | 'day') {
    this.calls.push({ filter, grain });
    return this.rows;
  }
}

class FakeWebEvents implements Pick<
  WebEventQueryRepository,
  | 'activityTimeseries'
  | 'listRecentEvents'
  | 'countActiveUsers'
  | 'listOnlineUsers'
  | 'countOnlineByApp'
> {
  activity: ActivityBucketRow[] = [];
  recent: LiveEventRow[] = [];
  activeUsers = 0;
  onlineUsers: OnlineUserRow[] = [];
  onlineApps: OnlineAppRow[] = [];
  recentCalls: Array<{ filter: TrafficFilter; limit: number }> = [];
  activeFilters: TrafficFilter[] = [];
  onlineUserCalls: Array<{ filter: TrafficFilter; limit: number }> = [];
  onlineAppFilters: TrafficFilter[] = [];
  async listOnlineUsers(filter: TrafficFilter, limit: number) {
    this.onlineUserCalls.push({ filter, limit });
    return this.onlineUsers;
  }
  async countOnlineByApp(filter: TrafficFilter) {
    this.onlineAppFilters.push(filter);
    return this.onlineApps;
  }
  async activityTimeseries() {
    return this.activity;
  }
  async listRecentEvents(filter: TrafficFilter, limit: number) {
    this.recentCalls.push({ filter, limit });
    return this.recent;
  }
  async countActiveUsers(filter: TrafficFilter) {
    this.activeFilters.push(filter);
    return this.activeUsers;
  }
}

function build() {
  const requests = new FakeRequests();
  const webEvents = new FakeWebEvents();
  const service = new LiveService(
    requests as unknown as ApiRequestQueryRepository,
    webEvents as unknown as WebEventQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, requests, webEvents };
}

describe('LiveService.snapshot', () => {
  it('returns LIVE_SNAPSHOT_MINUTES gap-filled minute ticks ending with the current minute', async () => {
    const { service, requests, webEvents } = build();
    requests.rows = [
      trafficBucketRow({
        bucket: new Date(CURRENT_MINUTE),
        requests: 7,
        errors_4xx: 1,
        errors_5xx: 2,
        p95_ms: 87.654,
      }),
    ];
    webEvents.activity = [{ bucket: new Date(FIRST_MINUTE), page_views: 3, tool_uses: 1 }];
    webEvents.activeUsers = 4;

    const { ticks } = await service.snapshot({}, PLAIN_VIEWER);

    expect(ticks).toHaveLength(LIVE_SNAPSHOT_MINUTES);
    expect(ticks[0]).toEqual({
      scope: 'all',
      minute: FIRST_MINUTE,
      requests: 0,
      errors4xx: 0,
      errors5xx: 0,
      p95Ms: null,
      pageViews: 3,
      toolUses: 1,
      activeUsers: 0,
    });
    expect(ticks.at(-1)).toEqual({
      scope: 'all',
      minute: CURRENT_MINUTE,
      requests: 7,
      errors4xx: 1,
      errors5xx: 2,
      p95Ms: 87.65,
      pageViews: 0,
      toolUses: 0,
      activeUsers: 4,
    });
    expect(requests.calls).toEqual([
      { filter: { from: new Date(FIRST_MINUTE), to: NOW, appId: undefined }, grain: 'minute' },
    ]);
  });

  it('scopes every query to the app and uses the active-user window', async () => {
    const { service, requests, webEvents } = build();
    const { ticks } = await service.snapshot({ app: 'ebo-sales' }, PLAIN_VIEWER);
    expect(ticks[0]?.scope).toBe('app:ebo-sales');
    expect(requests.calls[0]?.filter.appId).toBe(KNOWN_APP_ID);
    expect(webEvents.recentCalls[0]).toMatchObject({ limit: LIVE_SNAPSHOT_RECENT_EVENTS });
    expect(webEvents.activeFilters[0]).toEqual({
      from: new Date(NOW.getTime() - ACTIVE_USER_WINDOW_MS),
      to: NOW,
      appId: KNOWN_APP_ID,
    });
  });

  it('masks the IP of recent events for non-admin viewers', async () => {
    const { service, webEvents } = build();
    webEvents.recent = [liveEventRow()];
    const asViewer = await service.snapshot({}, PLAIN_VIEWER);
    const asAdmin = await service.snapshot({}, ADMIN_VIEWER);
    expect(asViewer.recent[0]).toMatchObject({
      ip: null,
      status: 500,
      durationMs: 12.35,
      app: 'ebo-sales',
    });
    expect(asAdmin.recent[0]?.ip).toBe('203.0.113.7');
  });

  it('404s an unknown app', async () => {
    const { service } = build();
    await expect(service.snapshot({ app: 'nope' }, PLAIN_VIEWER)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('LiveService.online', () => {
  const WINDOW_START = new Date(NOW.getTime() - ACTIVE_USER_WINDOW_MS);

  it('queries the last ACTIVE_USER_WINDOW_MS (to = now) for every app, capped at ONLINE_USERS_LIMIT', async () => {
    const { service, webEvents } = build();
    const dto = await service.online({});
    const expected: TrafficFilter = {
      from: WINDOW_START,
      to: NOW,
      appId: undefined,
      userKey: undefined,
    };
    expect(webEvents.onlineAppFilters).toEqual([expected]);
    expect(webEvents.onlineUserCalls).toEqual([{ filter: expected, limit: ONLINE_USERS_LIMIT }]);
    expect(dto).toEqual({
      asOf: NOW.toISOString(),
      windowMs: ACTIVE_USER_WINDOW_MS,
      apps: [],
      users: [],
    });
  });

  it('resolves the app slug and the hex user key into the filter of BOTH queries', async () => {
    const { service, webEvents } = build();
    await service.online({ app: 'ebo-sales', userKey: USER_KEY_HEX });
    for (const filter of [webEvents.onlineAppFilters[0], webEvents.onlineUserCalls[0]?.filter]) {
      expect(filter).toMatchObject({ from: WINDOW_START, to: NOW, appId: KNOWN_APP_ID });
      expect(filter?.userKey?.equals(USER_KEY)).toBe(true);
    }
  });

  it('maps apps and people in repository order (busiest app / newest person first), without IPs', async () => {
    const { service, webEvents } = build();
    webEvents.onlineApps = [
      { app_slug: 'ebo-sales', users: 2, anonymous: 3 },
      { app_slug: 'hr-portal', users: 1, anonymous: 0 },
    ];
    const newest = new Date('2026-10-01T10:00:25.000Z');
    const older = new Date('2026-10-01T09:58:00.000Z');
    webEvents.onlineUsers = [
      onlineUserRow({ last_seen_at: newest }),
      onlineUserRow({
        app_slug: 'hr-portal',
        last_seen_at: older,
        kind: 'page_view',
        path: '/leaves',
        method: null,
        status_code: null,
        endpoint_id: null,
        current_page: '/leaves',
        events: 1,
      }),
    ];

    const dto = await service.online({});

    expect(dto.apps).toEqual([
      { app: 'ebo-sales', users: 2, anonymous: 3 },
      { app: 'hr-portal', users: 1, anonymous: 0 },
    ]);
    expect(dto.users.map((u) => [u.app, u.lastSeenAt])).toEqual([
      ['ebo-sales', newest.toISOString()],
      ['hr-portal', older.toISOString()],
    ]);
    expect(dto.users[0]).toMatchObject({
      userKey: USER_KEY_HEX,
      lastEvent: { kind: 'api', path: '/ebo-sales/api/v1/stores/:id', method: 'GET', status: 200 },
    });
    expect(dto.users[1]).toMatchObject({
      currentPage: '/leaves',
      events: 1,
      lastEvent: { kind: 'page_view', path: '/leaves', method: null, status: null },
    });
    expect(JSON.stringify(dto)).not.toMatch(/"ip"/);
  });

  it('404s an unknown app before querying', async () => {
    const { service, webEvents } = build();
    await expect(service.online({ app: 'nope' })).rejects.toBeInstanceOf(NotFoundError);
    expect(webEvents.onlineUserCalls).toEqual([]);
  });
});
