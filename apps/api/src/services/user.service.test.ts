import { ERROR_CODES, type UserListQuery, type UserTimelineQuery } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  PLAIN_VIEWER,
  timelineEventRow,
  USER_KEY,
  USER_KEY_HEX,
  userSummaryRow,
} from '../../test/fixtures/analytics-rows';
import {
  FakeAppSlugs,
  FakeWebEventQueries,
  KNOWN_APP_ID,
  KNOWN_APP_SLUG,
} from '../../test/fixtures/fake-query-repositories';
import { decodeOffsetCursor, encodeKeysetCursor, encodeOffsetCursor } from '../db/sql';
import { BadRequestError, NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { UserService } from './user.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const ID_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const ID_3 = 'aaaaaaaa-0000-4000-8000-000000000003';

function build() {
  const webEvents = new FakeWebEventQueries();
  const service = new UserService(
    webEvents as unknown as WebEventQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, webEvents };
}

const listQuery = (overrides: Partial<UserListQuery> = {}): UserListQuery => ({
  range: '24h',
  limit: 2,
  ...overrides,
});

const timelineQuery = (overrides: Partial<UserTimelineQuery> = {}): UserTimelineQuery => ({
  range: '24h',
  limit: 2,
  ...overrides,
});

describe('UserService.list', () => {
  it('resolves the app, passes search, fetches limit + 1 and maps users with hex keys', async () => {
    const { service, webEvents } = build();
    webEvents.users = [userSummaryRow()];
    const page = await service.list(listQuery({ app: KNOWN_APP_SLUG, search: 'some' }));
    const [filter, options] = webEvents.argsOf('listUsers')[0] ?? [];
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID, to: NOW });
    expect(options).toEqual({ search: 'some', limit: 3, offset: 0 });
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
      countries: ['IN'],
    };
    const dto = await service.profile(USER_KEY_HEX, { range: '7d' });
    const [userKey] = webEvents.argsOf('getUserProfile')[0] ?? [];
    expect(Buffer.isBuffer(userKey) && userKey.equals(USER_KEY)).toBe(true);
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
    await expect(service.profile(USER_KEY_HEX, { range: '24h' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('allows 90 days (counts only) but not 120', async () => {
    const { service } = build();
    await expect(service.profile(USER_KEY_HEX, { range: '90d' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      service.profile(USER_KEY_HEX, {
        range: 'custom',
        from: '2026-06-01T00:00:00Z',
        to: '2026-10-01T00:00:00Z',
      }),
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
