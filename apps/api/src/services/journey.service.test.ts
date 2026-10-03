import { ERROR_CODES, type SessionListQuery } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  PLAIN_VIEWER,
  SESSION_ID,
  sessionEventRow,
  sessionSummaryRow,
  USER_KEY,
  USER_KEY_HEX,
} from '../../test/fixtures/analytics-rows';
import {
  FakeAppSlugs,
  FakeWebEventQueries,
  KNOWN_APP_ID,
  KNOWN_APP_SLUG,
} from '../../test/fixtures/fake-query-repositories';
import { decodeOffsetCursor } from '../db/sql';
import { NotFoundError } from '../errors/app-error';
import { FixedClock } from '../lib/clock';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import type { AppSlugResolver } from './app-slug.resolver';
import { JourneyService } from './journey.service';

const NOW = new Date('2026-10-01T10:00:00.000Z');

function build() {
  const webEvents = new FakeWebEventQueries();
  const service = new JourneyService(
    webEvents as unknown as WebEventQueryRepository,
    new FakeAppSlugs() as unknown as AppSlugResolver,
    new FixedClock(NOW),
  );
  return { service, webEvents };
}

const sessionsQuery = (overrides: Partial<SessionListQuery> = {}): SessionListQuery => ({
  range: '24h',
  limit: 1,
  ...overrides,
});

describe('JourneyService.sessions', () => {
  it('passes the user scope as bytes, fetches limit + 1 and returns an offset cursor', async () => {
    const { service, webEvents } = build();
    webEvents.sessions = [sessionSummaryRow(), sessionSummaryRow()];
    const page = await service.sessions(sessionsQuery({ userKey: USER_KEY_HEX }), ADMIN_VIEWER);
    const options = webEvents.argsOf('listSessions')[0]?.[1] as { userKey: Buffer; limit: number };
    expect(options.userKey.equals(USER_KEY)).toBe(true);
    expect(options.limit).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(decodeOffsetCursor(page.nextCursor ?? undefined)).toBe(1);
  });

  it('maps the strongest identity, durations rounded, IP for admins only', async () => {
    const { service, webEvents } = build();
    webEvents.sessions = [
      sessionSummaryRow({
        identity_source: 'client_claimed',
        claimed_email: 'x@y.z',
        user_key: null,
        user_email: null,
      }),
    ];
    const admin = await service.sessions(sessionsQuery(), ADMIN_VIEWER);
    expect(admin.items[0]).toMatchObject({
      sessionId: SESSION_ID,
      durationMs: 930250,
      userKey: null,
      claimedEmail: 'x@y.z',
      identitySource: 'client_claimed',
      ip: '8.8.8.8',
    });
    const plain = await service.sessions(sessionsQuery(), PLAIN_VIEWER);
    expect(plain.items[0]?.ip).toBeNull();
  });
});

describe('JourneyService.session', () => {
  it('scopes to the PATH app, interleaves API calls by time and folds nothing else', async () => {
    const { service, webEvents } = build();
    const t = (minute: number) => new Date(`2026-10-01T09:${String(minute).padStart(2, '0')}:00Z`);
    webEvents.session = {
      summary: sessionSummaryRow(),
      browserEvents: [
        sessionEventRow({ event_id: 'pv1', seq: 0, occurred_at: t(0), visible_ms: 4000 }),
        sessionEventRow({
          event_id: 'tool',
          seq: 1,
          occurred_at: t(2),
          kind: 'tool_use',
          tool: 'export-csv',
        }),
      ],
      apiCalls: [
        sessionEventRow({
          event_id: 'api',
          seq: null,
          occurred_at: t(1),
          kind: 'api',
          method: 'GET',
          status_code: 200,
          duration_ms: 12.345,
        }),
      ],
    };
    const dto = await service.session(
      KNOWN_APP_SLUG,
      SESSION_ID,
      { range: '24h', app: 'ignored' },
      ADMIN_VIEWER,
    );
    const [appId, sessionId, filter] = webEvents.argsOf('getSession')[0] ?? [];
    expect(appId).toBe(KNOWN_APP_ID);
    expect(sessionId).toBe(SESSION_ID);
    expect(filter).toMatchObject({ appId: KNOWN_APP_ID });
    expect(dto.events.map((e) => e.eventId)).toEqual(['pv1', 'api', 'tool']);
    expect(dto.events[1]).toMatchObject({ kind: 'api', status: 200, durationMs: 12.35, seq: null });
    expect(dto.events[0]?.visibleMs).toBe(4000);
  });

  it('unknown app or empty session → 404', async () => {
    const { service } = build();
    await expect(
      service.session('nope', SESSION_ID, { range: '24h' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      service.session(KNOWN_APP_SLUG, SESSION_ID, { range: '24h' }, ADMIN_VIEWER),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('JourneyService.topPaths', () => {
  it('returns the window and 3-step paths; capped like percentiles (31 days)', async () => {
    const { service, webEvents } = build();
    webEvents.topPaths = [
      {
        app_slug: 'ebo-sales',
        step1: '/home',
        step2: '/stores/:id',
        step3: '/reports',
        sessions: 2,
      },
    ];
    const dto = await service.topPaths({ range: '7d', limit: 5 });
    expect(webEvents.argsOf('listTopPaths')[0]?.[1]).toBe(5);
    expect(dto.window.to).toBe(NOW.toISOString());
    expect(dto.items).toEqual([
      { app: 'ebo-sales', steps: ['/home', '/stores/:id', '/reports'], sessions: 2 },
    ]);
    await expect(service.topPaths({ range: '90d', limit: 5 })).rejects.toMatchObject({
      code: ERROR_CODES.RANGE_TOO_LARGE,
    });
  });
});
