/**
 * Committed ingest rows (the camelCase inserts LiveFeed receives) for the live-layer tests.
 */
import type { ActorColumns, ApiRequestInsert, WebEventInsert } from '../../src/domain/inserts';

export const LIVE_IP = '203.0.113.7';
export const LIVE_OCCURRED_AT = new Date('2026-10-01T09:59:58.000Z');

function actor(overrides: Partial<ActorColumns> = {}): ActorColumns {
  return {
    userEmail: 'amit@libas.in',
    userKey: Buffer.alloc(32, 0xab),
    claimedEmail: null,
    identitySource: 'sso_cookie',
    ip: LIVE_IP,
    ipHash: null,
    ipClass: 'public',
    geoCountry: 'IN',
    geoRegion: 'MH',
    geoCity: 'Mumbai',
    geoLat: 19.07,
    geoLon: 72.87,
    uaBrowser: null,
    uaOs: null,
    uaDevice: null,
    sdk: null,
    ...overrides,
  };
}

export function apiRequestInsert(overrides: Partial<ApiRequestInsert> = {}): ApiRequestInsert {
  return {
    ...actor(),
    occurredAt: LIVE_OCCURRED_AT,
    eventId: '66666666-6666-4666-8666-666666666666',
    clockSkewMs: null,
    appId: '11111111-1111-4111-8111-111111111111',
    endpointId: '33333333-3333-5333-8333-333333333333',
    kind: 'http',
    method: 'GET',
    routeTemplate: '/api/orders/:id',
    path: '/api/orders/42',
    statusCode: 200,
    durationMs: 120,
    requestBytes: null,
    responseBytes: null,
    errorCode: null,
    release: null,
    requestId: null,
    sessionId: null,
    pageViewId: null,
    ...overrides,
  };
}

export function webEventInsert(overrides: Partial<WebEventInsert> = {}): WebEventInsert {
  return {
    ...actor(),
    occurredAt: LIVE_OCCURRED_AT,
    eventId: '77777777-7777-4777-8777-777777777777',
    clockSkewMs: null,
    appId: '11111111-1111-4111-8111-111111111111',
    sessionId: '55555555-5555-4555-8555-555555555555',
    anonymousId: null,
    seq: 1,
    eventType: 'page_view',
    path: '/ebo-sales/stores',
    pathTemplate: '/ebo-sales/stores',
    referrerPath: null,
    referrerHost: null,
    nav: 'load',
    pageViewId: null,
    visibleMs: null,
    isFinal: null,
    timeReason: null,
    tool: null,
    action: null,
    label: null,
    value: null,
    name: null,
    props: null,
    ...overrides,
  };
}
