/**
 * Valid domain records for DB suites — override only what a test is about.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { ApiRequestInsert } from '../../src/domain/inserts';

/** 32-byte digest, the shape of key_hash / user_key / ip_hash. */
export const sha256 = (text: string): Buffer => createHash('sha256').update(text).digest();

/** A valid, fully-populated api_requests row for `appId`. */
export function apiRequestRow(appId: string, overrides: Partial<ApiRequestInsert> = {}): ApiRequestInsert {
  return {
    occurredAt: new Date(),
    eventId: randomUUID(),
    clockSkewMs: 120,
    appId,
    endpointId: randomUUID(),
    kind: 'http',
    method: 'GET',
    routeTemplate: '/ebo-sales/api/stores/:id',
    path: '/ebo-sales/api/stores/42',
    statusCode: 200,
    durationMs: 12.5,
    requestBytes: 0,
    responseBytes: 2048,
    errorCode: null,
    release: '1.4.2',
    requestId: 'req-1',
    sessionId: randomUUID(),
    pageViewId: null,
    userEmail: 'someone@libas.in',
    userKey: sha256('someone@libas.in'),
    claimedEmail: null,
    identitySource: 'app_attested',
    ip: '203.0.113.7',
    ipHash: null,
    ipClass: 'public',
    geoCountry: 'IN',
    geoRegion: 'DL',
    geoCity: 'Delhi',
    geoLat: 28.6,
    geoLon: 77.2,
    uaBrowser: 'Chrome 120',
    uaOs: 'Windows 10',
    uaDevice: 'desktop',
    sdk: '@nexus/express@1.0.0',
    ...overrides,
  };
}
