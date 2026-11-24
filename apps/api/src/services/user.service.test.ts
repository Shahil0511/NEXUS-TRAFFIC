import {
  ERROR_CODES,
  USER_DAILY_APP_ROWS_LIMIT,
  USER_DEVICES_LIMIT,
  type UserListQuery,
  type UserTimelineQuery,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  PLAIN_VIEWER,
  timelineEventRow,
  USER_KEY,
  USER_KEY_HEX,
  userDayAppActivityRow,
  userDeviceRow,
  userLatestContextRow,
  userSummaryRow,
} from '../../test/fixtures/analytics-rows';
import {
  FakeApiRequestQueries,
  FakeAppSlugs,
  FakePersonAccess,
  FakeWebEventQueries,
  KNOWN_APP_ID,
  KNOWN_APP_SLUG,
} from '../../test/fixtures/fake-query-repositories';
import { decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '../db/sql';
import { BadRequestError, NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { ApiRequestQueryRepository } from '../repositories/api-request-query.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import type { PersonAccessRecorder } from './person-access.recorder';
import { UserService } from './user.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const ID_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ID_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

function build() {
  const webEvents = new FakeWebEventQueries();
  const requests = new FakeApiRequestQueries();
  const access = new FakePersonAccess();
  const service = new UserService(
    webEvents as unknown as WebEventQueryRepository,
    requests as unknown as ApiRequestQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
    access as unknown as PersonAccessRecorder,
  );
  return { service, webEvents, requests, access };
}

const listQuery = (overrides: Partial<UserListQuery> = {}): UserListQuery => ({
  range: '24h',
  limit: 2,
  sort: 'lastSeen',
  dir: 'desc',
  ...overrides,
});

const timelineQuery = (overrides: Partial<UserTimelineQuery> = {}): UserTimelineQuery => ({
  range: '24h',
  limit: 2,
  ...overrides,
});

describe('UserService.search', () => {
  it('passes the email substring from the BODY to the same list query', async () => {
    const { service, webEvents } = build();
    webEvents.users = [userSummaryRow()];
    const page = await service.search({ ...listQuery({ app: KNOWN_APP_SLUG }), search: 'some' });
    const [filter, options] = webEvents.argsOf('listUsers')[0] ?? [];
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID, to: NOW });
    expect(options).toEqual({ search: 'some', sort: 'lastSeen', dir: 'desc', limit: 3, offset: 0 });
    expect(page.items[0]?.email).toBe('someone@libas.in');
  });
});

describe('UserService.list', () => {
  it('resolves the app, fetches limit + 1 and maps users with hex keys', async () => {
    const { service, webEvents } = build();
    webEvents.users = [userSummaryRow()];
    const page = await service.list(listQuery({ app: KNOWN_APP_SLUG }));
    const [filter, options] = webEvents.argsOf('listUsers')[0] ?? [];
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID, to: NOW });
    expect(options).toEqual({
      search: undefined,
      sort: 'lastSeen',
      dir: 'desc',
      limit: 3,
      offset: 0,
    });
    expect(page.items[0]).toMatchObject({
      userKey: USER_KEY_HEX,
      email: 'someone@libas.in',
      requests: 12,
      pageViews: 5,
      sessions: 2,
      apps: ['ebo-sales', 'hr-portal'],
    });
    expect(page.nextCursor).toBeNull();
  });

  it('offset cursor: a full extra row means a next page at offset + limit', async () => {
    const { service, webEvents } = build();
    webEvents.users = [userSummaryRow(), userSummaryRow(), userSummaryRow()];
    const page = await service.list(listQuery());
    expect(page.items).toHaveLength(2);
    expect(decodeOffsetCursor(page.nextCursor ?? undefined)).toBe(2);

    await service.list(listQuery({ cursor: encodeOffsetCursor(2) }));
    expect(webEvents.argsOf('listUsers')[1]?.[1]).toMatchObject({ offset: 2 });
  });

  it('an unknown app is a 404', async () => {
    const { service } = build();
    await expect(service.list(listQuery({ app: 'nope' }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('UserService.profile', () => {
  it('queries by the stored user_key (bytes from the hex param) and maps the profile', async () => {
    const { service, webEvents } = build();
    webEvents.profile = {
      summary: userSummaryRow(),
      topTools: [{ app_slug: 'ebo-sales', tool: 'export-csv', uses: 3 }],
      topPages: [{ app_slug: 'ebo-sales', path_template: '/home', views: 4 }],
      perApp: [],
      countries: ['IN'],
    };
    webEvents.latestContext = userLatestContextRow();
    const dto = await service.profile(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    const [userKey, filter] = webEvents.argsOf('getUserProfile')[0] ?? [];
    expect(Buffer.isBuffer(userKey) && userKey.equals(USER_KEY)).toBe(true);
    // The identity card's latest facts come with the profile (one access-log surface).
    expect(webEvents.argsOf('getUserLatestContext')[0]?.[1]).toEqual(filter);
    expect(dto.latest).toMatchObject({ timeZone: 'Asia/Kolkata', language: 'en-IN' });
    expect(dto).toMatchObject({
      summary: { userKey: USER_KEY_HEX },
      firstSeenAt: '2026-10-01T08:00:00.000Z',
      failedRequests: 2,
      topTools: [{ app: 'ebo-sales', tool: 'export-csv', uses: 3 }],
      topPages: [{ app: 'ebo-sales', pathTemplate: '/home', views: 4 }],
      countries: ['IN'],
    });
  });

  it('no activity in the window is a 404', async () => {
    const { service } = build();
    await expect(
      service.profile(USER_KEY_HEX, { range: '24h' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('allows 90 days (counts only) but not 120', async () => {
    const { service } = build();
    await expect(
      service.profile(USER_KEY_HEX, { range: '90d' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.profile(
        USER_KEY_HEX,
        {
          range: 'custom',
          from: '2026-06-01T00:00:00Z',
          to: '2026-10-01T00:00:00Z',
        },
        ADMIN_VIEWER,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.RANGE_TOO_LARGE });
  });
});

describe('UserService.timeline', () => {
  const at = (eventId: string, key: string) =>
    timelineEventRow({ event_id: eventId, occurred_at: new Date(key), occurred_at_key: key });

  it('keyset-pages from the last SHOWN row (µs precision kept) and decodes it next time', async () => {
    const { service, webEvents } = build();
    webEvents.timeline = [
      at(ID_1, '2026-10-01T09:03:00.000001Z'),
      at(ID_2, '2026-10-01T09:02:00.000002Z'),
      at(ID_3, '2026-10-01T09:01:00.000003Z'),
    ];
    const page = await service.timeline(USER_KEY_HEX, timelineQuery(), ADMIN_VIEWER);
    expect(page.items.map((i) => i.eventId)).toEqual([ID_1, ID_2]);
    expect(page.nextCursor).toBe(encodeKeysetCursor('2026-10-01T09:02:00.000002Z', ID_2));
    expect(webEvents.argsOf('listUserTimeline')[0]?.[2]).toEqual({ after: null, limit: 3 });

    await service.timeline(
      USER_KEY_HEX,
      timelineQuery({ cursor: page.nextCursor ?? undefined }),
      ADMIN_VIEWER,
    );
    expect(webEvents.argsOf('listUserTimeline')[1]?.[2]).toMatchObject({
      after: { occurredAt: '2026-10-01T09:02:00.000002Z', eventId: ID_2 },
    });
  });

  it('a malformed cursor is a 400', async () => {
    const { service } = build();
    await expect(
      service.timeline(USER_KEY_HEX, timelineQuery({ cursor: 'garbage' }), ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it('admins see the IP, other viewers never do', async () => {
    const { service, webEvents } = build();
    webEvents.timeline = [timelineEventRow()];
    const admin = await service.timeline(USER_KEY_HEX, timelineQuery(), ADMIN_VIEWER);
    expect(admin.items[0]?.ip).toBe('8.8.8.8');
    const plain = await service.timeline(USER_KEY_HEX, timelineQuery(), PLAIN_VIEWER);
    expect(plain.items[0]?.ip).toBeNull();
    expect(JSON.stringify(plain)).not.toContain('8.8.8.8');
  });
});

describe('UserService.activity', () => {
  it('gap-fills DAU per IST day and counts WAU/MAU ending at the window end', async () => {
    const { service, webEvents } = build();
    webEvents.dailyUsers = [{ day: new Date('2026-09-30T18:30:00Z'), users: 3 }];
    webEvents.identifiedUsers = [5, 9];
    const dto = await service.activity({ range: '7d' });
    expect(dto.points.length).toBeGreaterThanOrEqual(7);
    expect(dto.points.find((p) => p.day === '2026-09-30T18:30:00.000Z')?.users).toBe(3);
    expect(dto.points.every((p) => p.users >= 0)).toBe(true);
    expect(dto.wau).toBe(5);
    expect(dto.mau).toBe(9);
    const [wau, mau] = webEvents.argsOf('countIdentifiedUsers').map((args) => args[0]);
    expect(wau).toMatchObject({ from: new Date(NOW.getTime() - 7 * 86_400_000), to: NOW });
    expect(mau).toMatchObject({ from: new Date(NOW.getTime() - 30 * 86_400_000), to: NOW });
  });
});

describe('UserService.profile (routes and apps)', () => {
  it("adds the user's top API routes from the request repository", async () => {
    const { service, webEvents, requests } = build();
    webEvents.profile = {
      summary: userSummaryRow(),
      topTools: [],
      topPages: [],
      perApp: [
        {
          app_slug: 'ebo-sales',
          requests: 4,
          page_views: 2,
          tool_uses: 1,
          sessions: 1,
          last_seen_at: NOW,
        },
      ],
      countries: [],
    };
    requests.userTopEndpoints = [
      {
        endpoint_id: ID_1,
        app_slug: 'ebo-sales',
        method: 'GET',
        route_template: '/api/x',
        calls: 4,
        failed: 1,
      },
    ];
    const dto = await service.profile(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    expect(dto.topEndpoints).toEqual([
      {
        endpointId: ID_1,
        app: 'ebo-sales',
        method: 'GET',
        routeTemplate: '/api/x',
        calls: 4,
        failed: 1,
      },
    ]);
    expect(dto.perApp[0]).toMatchObject({ app: 'ebo-sales', requests: 4, pageViews: 2 });
    expect(requests.argsOf('listUserTopEndpoints')[0]?.[0]).toEqual(
      Buffer.from(USER_KEY_HEX, 'hex'),
    );
  });
});

describe('UserService.devices', () => {
  it('reads the devices (capped) by the stored user_key, without the latest context', async () => {
    const { service, webEvents } = build();
    webEvents.userDevices = [userDeviceRow()];
    const dto = await service.devices(
      USER_KEY_HEX,
      { range: '7d', app: KNOWN_APP_SLUG },
      ADMIN_VIEWER,
    );
    const [userKey, filter, limit] = webEvents.argsOf('listUserDevices')[0] ?? [];
    expect(Buffer.isBuffer(userKey) && userKey.equals(USER_KEY)).toBe(true);
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID, to: NOW });
    expect(limit).toBe(USER_DEVICES_LIMIT);
    expect(webEvents.argsOf('getUserLatestContext')).toEqual([]);
    expect(dto.window.to).toBe(NOW.toISOString());
    expect(dto.items).toEqual([
      expect.objectContaining({ device: 'desktop', browser: 'Chrome 126', visits: 2 }),
    ]);
    expect(dto).not.toHaveProperty('latest');
  });

  it('no activity is an empty list (never a 404)', async () => {
    const { service } = build();
    expect(await service.devices(USER_KEY_HEX, { range: '24h' }, ADMIN_VIEWER)).toMatchObject({
      items: [],
    });
  });

  it('is bounded like the profile: 90 days yes, 120 no', async () => {
    const { service } = build();
    await expect(
      service.devices(
        USER_KEY_HEX,
        {
          range: 'custom',
          from: '2026-06-01T00:00:00Z',
          to: '2026-10-01T00:00:00Z',
        },
        ADMIN_VIEWER,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.RANGE_TOO_LARGE });
  });
});

/** 2 Oct 00:00 IST (NOW is 15:30 IST on 1 Oct) and 24 Sep 00:00 IST. */
const END_OF_TODAY = new Date('2026-10-01T18:30:00.000Z');
const DAILY_FROM = new Date('2026-09-23T18:30:00.000Z');

describe('UserService.daily', () => {
  it('maps the active days newest first over WHOLE IST days; today is in progress', async () => {
    const { service, webEvents } = build();
    webEvents.userDays = [
      userDayAppActivityRow(),
      userDayAppActivityRow({ day: new Date('2026-09-29T18:30:00.000Z'), active_ms: 0 }),
    ];
    const dto = await service.daily(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    const [userKey, filter] = webEvents.argsOf('listUserDailyActivity')[0] ?? [];
    expect(Buffer.isBuffer(userKey) && userKey.equals(USER_KEY)).toBe(true);
    // 7d ending 15:30 IST 1 Oct → 24 Sep 00:00 IST up to 2 Oct 00:00 IST (no day cut in half).
    expect(filter).toMatchObject({ from: DAILY_FROM, to: END_OF_TODAY });
    expect(dto.window).toMatchObject({
      from: DAILY_FROM.toISOString(),
      to: END_OF_TODAY.toISOString(),
    });
    expect(dto.items.map((d) => d.inProgress)).toEqual([true, false]);
    expect(dto.items.map((d) => d.day)).toEqual([
      '2026-09-30T18:30:00.000Z',
      '2026-09-29T18:30:00.000Z',
    ]);
    expect(dto.items[0]).toMatchObject({ activeMs: 11_520_000, failedRequests: 2, visits: 2 });
    expect(dto.items[0]?.perApp.map((app) => app.app)).toEqual(['ebo-sales']);
  });

  it('folds the per-app rows of one day into one item, apps in first-activity order', async () => {
    const { service, webEvents } = build();
    webEvents.userDays = [
      userDayAppActivityRow({
        app: 'hr-portal',
        first_activity_at: new Date('2026-10-01T02:00:00.000Z'),
        active_ms: 0,
        visits: 1,
      }),
      userDayAppActivityRow(),
    ];
    const dto = await service.daily(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({
      firstActivityAt: '2026-10-01T02:00:00.000Z',
      activeMs: 11_520_000,
      visits: 3,
      apps: ['ebo-sales', 'hr-portal'],
    });
    expect(dto.items[0]?.perApp.map((app) => app.app)).toEqual(['hr-portal', 'ebo-sales']);
  });

  it('drops the oldest day when the row cap was hit (no day shown with apps missing)', async () => {
    const { service, webEvents } = build();
    const today = new Date('2026-09-30T18:30:00.000Z');
    const older = new Date('2026-09-29T18:30:00.000Z');
    webEvents.userDays = [
      ...Array.from({ length: USER_DAILY_APP_ROWS_LIMIT }, (_, i) =>
        userDayAppActivityRow({ day: today, app: `app-${i}` }),
      ),
      userDayAppActivityRow({ day: older }),
    ];
    const dto = await service.daily(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    expect(dto.items.map((d) => d.day)).toEqual([today.toISOString()]);
    expect(dto.items[0]?.perApp).toHaveLength(USER_DAILY_APP_ROWS_LIMIT);
  });

  it('an unknown app is a 404; a too-long window is refused', async () => {
    const { service } = build();
    await expect(
      service.daily(USER_KEY_HEX, { range: '7d', app: 'nope' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.daily(
        USER_KEY_HEX,
        {
          range: 'custom',
          from: '2026-06-01T00:00:00Z',
          to: '2026-10-01T00:00:00Z',
        },
        ADMIN_VIEWER,
      ),
    ).rejects.toMatchObject({ code: ERROR_CODES.RANGE_TOO_LARGE });
  });
});

describe('UserService person access log', () => {
  const profileRows = () => ({
    summary: userSummaryRow(),
    topTools: [],
    topPages: [],
    perApp: [],
    countries: [],
  });

  it('records ONE access per person leaf, with the viewer, stored key, surface and window', async () => {
    const { service, webEvents, access } = build();
    webEvents.profile = profileRows();
    await service.profile(USER_KEY_HEX, { range: '7d', app: KNOWN_APP_SLUG }, ADMIN_VIEWER);
    await service.timeline(USER_KEY_HEX, timelineQuery(), ADMIN_VIEWER);
    await service.devices(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);
    await service.daily(USER_KEY_HEX, { range: '7d' }, ADMIN_VIEWER);

    expect(access.accesses.map((a) => a.surface)).toEqual([
      'person_profile',
      'person_timeline',
      'person_devices',
      'person_daily',
    ]);
    for (const recorded of access.accesses) {
      expect(recorded.viewer).toBe(ADMIN_VIEWER);
      expect(recorded.subjectUserKey.equals(USER_KEY)).toBe(true);
      expect(recorded.filter.to).toEqual(recorded.surface === 'person_daily' ? END_OF_TODAY : NOW);
    }
    expect(access.accesses[0]?.filter.appId).toBe(KNOWN_APP_ID);
  });

  it('records nothing when the read fails (404 profile, unknown app, too-long range)', async () => {
    const { service, access } = build();
    await expect(service.profile(USER_KEY_HEX, { range: '24h' }, ADMIN_VIEWER)).rejects.toThrow();
    await expect(
      service.daily(USER_KEY_HEX, { range: '7d', app: 'nope' }, ADMIN_VIEWER),
    ).rejects.toThrow();
    await expect(
      service.devices(
        USER_KEY_HEX,
        { range: 'custom', from: '2026-06-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
        ADMIN_VIEWER,
      ),
    ).rejects.toThrow();
    expect(access.accesses).toEqual([]);
  });

  it('lists are not person-level: list, search and activity record nothing', async () => {
    const { service, access } = build();
    await service.list(listQuery());
    await service.search({ ...listQuery(), search: 'some' });
    await service.activity({ range: '7d' });
    expect(access.accesses).toEqual([]);
  });
});
