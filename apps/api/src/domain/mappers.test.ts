import { toToolId } from '@nexus/shared/endpoint-id';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_VIEWER,
  apiRequestSampleRow,
  ENDPOINT_ID,
  endpointStatsRow,
  EVENT_ID,
  geoCityRow,
  OCCURRED_AT,
  onlineUserRow,
  pageStatsRow,
  PLAIN_VIEWER,
  SESSION_ID,
  sessionEventRow,
  sessionSummaryRow,
  timelineEventRow,
  toolUsageRow,
  trafficBucketRow,
  USER_KEY_HEX,
  userSummaryRow,
} from '../../test/fixtures/analytics-rows';
import { apiKeyRow, appRow, CREATED_AT } from '../../test/fixtures/app-rows';
import {
  mapActor,
  mapApiKey,
  mapApp,
  mapEndpointStats,
  mapGeoCity,
  mapGeoCountry,
  mapOnlineApp,
  mapOnlineUser,
  mapPageStats,
  mapRequestSample,
  mapSessionEvent,
  mapSessionSummary,
  mapStatusCount,
  mapTimelineItem,
  mapTimeseriesPoint,
  mapToolUsage,
  mapTopPath,
  mapUserProfile,
  mapUserSummary,
} from './mappers';

describe('mapApiKey', () => {
  it('maps every column to camelCase with ISO dates', () => {
    const later = new Date('2026-09-20T12:30:00.000Z');
    const dto = mapApiKey(
      apiKeyRow({
        expires_at: later,
        last_used_at: later,
        last_sdk: '@nexus/express@1.0.0',
        exposed_at: later,
      }),
    );
    expect(dto).toEqual({
      id: apiKeyRow().id,
      kind: 'secret',
      keyPrefix: 'nx_sk_AbCdEfGh',
      label: 'production',
      publicKey: null,
      createdAt: CREATED_AT.toISOString(),
      createdBy: 'admin@libas.in',
      expiresAt: later.toISOString(),
      lastUsedAt: later.toISOString(),
      lastSdk: '@nexus/express@1.0.0',
      exposedAt: later.toISOString(),
      revokedAt: null,
    });
  });

  it('NEVER exposes the key hash or the revoker', () => {
    const dto = mapApiKey(apiKeyRow({ revoked_at: CREATED_AT, revoked_by: 'boss@libas.in' }));
    expect(dto).not.toHaveProperty('keyHash');
    expect(dto).not.toHaveProperty('key_hash');
    expect(JSON.stringify(dto)).not.toContain('boss@libas.in');
    expect(dto.revokedAt).toBe(CREATED_AT.toISOString());
  });

  it('returns the public key for publishable keys only', () => {
    const pk = 'nx_pk_' + 'a'.repeat(32);
    expect(mapApiKey(apiKeyRow({ kind: 'publishable', public_key: pk })).publicKey).toBe(pk);
    expect(
      mapApiKey(apiKeyRow({ kind: 'secret', public_key: 'should-not-leak' })).publicKey,
    ).toBeNull();
  });
});

describe('mapApp', () => {
  it('maps the app by slug (no internal id) with its keys', () => {
    const dto = mapApp(appRow(), [apiKeyRow()]);
    expect(dto).toEqual({
      slug: 'ebo-sales',
      displayName: 'EBO Sales',
      basePath: '/ebo-sales',
      allowedOrigins: ['https://nexus.libas.in'],
      isActive: true,
      browserIngestEnabled: true,
      createdAt: CREATED_AT.toISOString(),
      keys: [mapApiKey(apiKeyRow())],
    });
    expect(dto).not.toHaveProperty('id');
  });

  it('copies allowed origins (no aliasing of the row array)', () => {
    const row = appRow();
    const dto = mapApp(row, []);
    dto.allowedOrigins.push('https://evil.example');
    expect(row.allowed_origins).toEqual(['https://nexus.libas.in']);
    expect(dto.keys).toEqual([]);
  });
});

// ─── Analytics mappers ──────────────────────────────────────────────────────

describe('mapActor / mapRequestSample — IP is ADMIN-ONLY', () => {
  it('admins see the stored IP', () => {
    expect(mapActor(apiRequestSampleRow(), ADMIN_VIEWER).ip).toBe('8.8.8.8');
  });

  it('non-admins NEVER receive the IP, anywhere in the payload', () => {
    const dto = mapRequestSample(apiRequestSampleRow(), PLAIN_VIEWER);
    expect(dto.actor.ip).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('8.8.8.8');
  });

  it('renders user_key as 64-char hex and keeps the identity fields', () => {
    const actor = mapActor(apiRequestSampleRow(), PLAIN_VIEWER);
    expect(actor).toEqual({
      userKey: 'ab'.repeat(32),
      userEmail: 'someone@libas.in',
      claimedEmail: null,
      identitySource: 'app_attested',
      ip: null,
      geo: { country: 'US', region: 'CA', city: 'Mountain View' },
    });
  });

  it('anonymous rows have no user key and an all-null location becomes geo: null', () => {
    const actor = mapActor(
      apiRequestSampleRow({
        user_email: null,
        user_key: null,
        identity_source: 'anonymous',
        geo_country: null,
        geo_region: null,
        geo_city: null,
      }),
      ADMIN_VIEWER,
    );
    expect(actor.userKey).toBeNull();
    expect(actor.geo).toBeNull();
  });
});

describe('mapRequestSample', () => {
  it('maps status_code → status, ISO dates and rounded duration', () => {
    expect(mapRequestSample(apiRequestSampleRow(), ADMIN_VIEWER)).toMatchObject({
      eventId: EVENT_ID,
      occurredAt: OCCURRED_AT.toISOString(),
      app: 'ebo-sales',
      kind: 'http',
      method: 'POST',
      endpointId: ENDPOINT_ID,
      status: 500,
      durationMs: 1290.4,
      errorCode: 'REPORT_TIMEOUT',
      requestId: 'req-1',
    });
  });
});

describe('mapEndpointStats', () => {
  it('derives the error rate and rounds latencies', () => {
    expect(mapEndpointStats(endpointStatsRow())).toEqual({
      endpointId: ENDPOINT_ID,
      app: 'ebo-sales',
      method: 'GET',
      routeTemplate: '/ebo-sales/api/v1/stores/:id',
      calls: 200,
      errors4xx: 6,
      errors5xx: 2,
      errorRate: 4,
      p50Ms: 41.7,
      p95Ms: 120.25,
      p99Ms: 480,
      avgMs: 55.12,
      lastSeenAt: OCCURRED_AT.toISOString(),
    });
  });

  it('keeps null percentiles (a stream-only endpoint has no latency)', () => {
    const dto = mapEndpointStats(
      endpointStatsRow({ p50_ms: null, p95_ms: null, p99_ms: null, avg_ms: null }),
    );
    expect([dto.p50Ms, dto.p95Ms, dto.p99Ms, dto.avgMs]).toEqual([null, null, null, null]);
  });
});

describe('mapTimeseriesPoint / mapStatusCount', () => {
  it('maps a bucket with ISO time and default page views 0', () => {
    expect(mapTimeseriesPoint(trafficBucketRow())).toEqual({
      bucket: '2026-10-01T08:30:00.000Z',
      requests: 10,
      errors4xx: 1,
      errors5xx: 1,
      p95Ms: 99.5,
      pageViews: 0,
    });
    expect(mapTimeseriesPoint(trafficBucketRow(), 3).pageViews).toBe(3);
  });

  it('maps a status count', () => {
    expect(mapStatusCount({ status_code: 404, count: 12 })).toEqual({ status: 404, count: 12 });
  });
});

// ─── S3 browser analytics ───────────────────────────────────────────────────

describe('mapUserSummary / mapUserProfile', () => {
  it('renders user_key as 64-char hex and copies the counts', () => {
    expect(mapUserSummary(userSummaryRow())).toEqual({
      userKey: USER_KEY_HEX,
      email: 'someone@libas.in',
      lastSeenAt: OCCURRED_AT.toISOString(),
      requests: 12,
      pageViews: 5,
      sessions: 2,
      failedRequests: 2,
      firstSeenAt: '2026-10-01T08:00:00.000Z',
      apps: ['ebo-sales', 'hr-portal'],
    });
    expect(USER_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
  });

  it('maps the profile header and its top lists', () => {
    const dto = mapUserProfile(
      {
        summary: userSummaryRow(),
        topTools: [{ app_slug: 'ebo-sales', tool: 'export-csv', uses: 2 }],
        topPages: [{ app_slug: 'ebo-sales', path_template: '/home', views: 3 }],
        perApp: [],
        countries: ['IN', 'AE'],
      },
      [],
    );
    expect(dto).toMatchObject({
      firstSeenAt: '2026-10-01T08:00:00.000Z',
      failedRequests: 2,
      topTools: [{ app: 'ebo-sales', tool: 'export-csv', uses: 2 }],
      topPages: [{ app: 'ebo-sales', pathTemplate: '/home', views: 3 }],
      countries: ['IN', 'AE'],
    });
  });
});

describe('mapTimelineItem', () => {
  it('maps an API call (status, rounded duration) and masks the IP for non-admins', () => {
    const row = timelineEventRow({
      kind: 'api',
      method: 'POST',
      status_code: 500,
      duration_ms: 12.3456,
      visible_ms: null,
    });
    expect(mapTimelineItem(row, ADMIN_VIEWER)).toMatchObject({
      eventId: EVENT_ID,
      kind: 'api',
      method: 'POST',
      status: 500,
      durationMs: 12.35,
      ip: '8.8.8.8',
    });
    expect(mapTimelineItem(row, PLAIN_VIEWER).ip).toBeNull();
  });

  it('keeps the folded visible time of a page view', () => {
    expect(mapTimelineItem(timelineEventRow(), ADMIN_VIEWER)).toMatchObject({
      kind: 'page_view',
      visibleMs: 4200,
      status: null,
      durationMs: null,
    });
  });
});

describe('mapSessionSummary / mapSessionEvent', () => {
  it('rounds the duration to whole ms and shows the IP to admins only', () => {
    const admin = mapSessionSummary(sessionSummaryRow(), ADMIN_VIEWER);
    expect(admin).toMatchObject({
      durationMs: 930250,
      userKey: USER_KEY_HEX,
      entryPath: '/home',
      exitPath: '/reports',
      ip: '8.8.8.8',
    });
    expect(mapSessionSummary(sessionSummaryRow(), PLAIN_VIEWER).ip).toBeNull();
    expect(
      mapSessionSummary(sessionSummaryRow({ user_key: null }), ADMIN_VIEWER).userKey,
    ).toBeNull();
  });

  it('maps a replay step without identity or IP', () => {
    const dto = mapSessionEvent(sessionEventRow({ kind: 'custom', name: 'leave_submitted' }));
    expect(dto).toEqual({
      eventId: EVENT_ID,
      occurredAt: OCCURRED_AT.toISOString(),
      seq: 0,
      kind: 'custom',
      path: '/home',
      tool: null,
      visibleMs: null,
      name: 'leave_submitted',
      method: null,
      status: null,
      durationMs: null,
      endpointId: null,
    });
  });
});

describe('pages / tools / paths / geo mappers', () => {
  it('mapTopPath lists the three steps in order', () => {
    expect(
      mapTopPath({ app_slug: 'ebo-sales', step1: '/a', step2: '/b', step3: '/c', sessions: 4 }),
    ).toEqual({ app: 'ebo-sales', steps: ['/a', '/b', '/c'], sessions: 4 });
  });

  it('mapPageStats rounds visible time to whole ms (null stays null)', () => {
    expect(mapPageStats(pageStatsRow())).toMatchObject({ avgVisibleMs: 3500, p50VisibleMs: 3001 });
    expect(
      mapPageStats(pageStatsRow({ avg_visible_ms: null, p50_visible_ms: null })),
    ).toMatchObject({ avgVisibleMs: null, p50VisibleMs: null });
  });

  it('mapToolUsage never exposes the internal app id', () => {
    const dto = mapToolUsage(toolUsageRow(), [{ bucket: '2026-10-01T08:30:00.000Z', uses: 1 }]);
    expect(dto).toEqual({
      toolId: toToolId('ebo-sales', 'export-csv'),
      app: 'ebo-sales',
      tool: 'export-csv',
      uses: 7,
      distinctUsers: 2,
      distinctSessions: 4,
      lastUsedAt: OCCURRED_AT.toISOString(),
      trend: [{ bucket: '2026-10-01T08:30:00.000Z', uses: 1 }],
    });
    expect(JSON.stringify(dto)).not.toContain(toolUsageRow().app_id);
  });

  it('mapGeoCountry / mapGeoCity (centroid rounded to 4 decimals)', () => {
    expect(mapGeoCountry({ country: 'IN', requests: 3, page_views: 4, users: 1 })).toEqual({
      country: 'IN',
      requests: 3,
      pageViews: 4,
      users: 1,
    });
    expect(mapGeoCity(geoCityRow())).toMatchObject({ lat: 19.076, lon: 72.8777 });
    expect(mapGeoCity(geoCityRow({ lat: null, lon: null }))).toMatchObject({
      lat: null,
      lon: null,
    });
  });
});

describe('mapOnlineUser / mapOnlineApp', () => {
  it('maps an API call as the last event (route template label, hex user key, ISO time)', () => {
    expect(mapOnlineUser(onlineUserRow())).toEqual({
      userKey: USER_KEY_HEX,
      email: 'someone@libas.in',
      app: 'ebo-sales',
      sessionId: SESSION_ID,
      currentPage: '/stores/:id',
      lastEvent: {
        kind: 'api',
        path: '/ebo-sales/api/v1/stores/:id',
        tool: null,
        method: 'GET',
        status: 200,
        endpointId: ENDPOINT_ID,
      },
      lastSeenAt: OCCURRED_AT.toISOString(),
      events: 3,
    });
  });

  it('maps a browser tool use (no method / status / route) and API-only activity (no page)', () => {
    const tool = mapOnlineUser(
      onlineUserRow({
        kind: 'tool_use',
        path: '/stores/:id',
        tool: 'export-csv',
        method: null,
        status_code: null,
        endpoint_id: null,
      }),
    );
    expect(tool.lastEvent).toEqual({
      kind: 'tool_use',
      path: '/stores/:id',
      tool: 'export-csv',
      method: null,
      status: null,
      endpointId: null,
    });
    const serverOnly = mapOnlineUser(onlineUserRow({ session_id: null, current_page: null }));
    expect(serverOnly).toMatchObject({ sessionId: null, currentPage: null });
  });

  it('NEVER carries an IP field', () => {
    const dto = mapOnlineUser({ ...onlineUserRow(), ip: '8.8.8.8' } as never);
    expect(Object.keys(dto)).not.toContain('ip');
    expect(JSON.stringify(dto)).not.toContain('8.8.8.8');
  });

  it('mapOnlineApp copies the counts by slug', () => {
    expect(mapOnlineApp({ app_slug: 'hr-portal', users: 2, anonymous: 5 })).toEqual({
      app: 'hr-portal',
      users: 2,
      anonymous: 5,
    });
  });
});
