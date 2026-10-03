import { serverEventSchema } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { serverEvent } from '../../test/ingest-fixtures';
import type { ActorColumns } from './inserts';
import { toApiRequestInsert } from './to-api-request-insert';

const ACTOR: ActorColumns = {
  userEmail: null,
  userKey: null,
  claimedEmail: null,
  identitySource: 'anonymous',
  ip: null,
  ipHash: null,
  ipClass: 'unknown',
  geoCountry: null,
  geoRegion: null,
  geoCity: null,
  geoLat: null,
  geoLon: null,
  uaBrowser: null,
  uaOs: null,
  uaDevice: null,
  sdk: null,
};

describe('toApiRequestInsert', () => {
  const enrichment = {
    appId: 'app-1',
    endpointId: 'endpoint-1',
    path: '/sanitized',
    routeTemplate: '/template',
    clockSkewMs: 42,
    actor: ACTOR,
  };

  it('maps wire `status` to `statusCode` and the ISO time to a Date (same instant)', () => {
    const event = serverEventSchema.parse(
      serverEvent({ status: 503, occurredAt: '2026-10-01T15:29:58.123+05:30' }),
    );
    const row = toApiRequestInsert(event, enrichment);
    expect(row.statusCode).toBe(503);
    expect(row.occurredAt.toISOString()).toBe('2026-10-01T09:59:58.123Z');
  });

  it('turns absent optionals into null and keeps the enrichment values', () => {
    const event = serverEventSchema.parse(serverEvent({ path: '/raw?x=1' }));
    expect(toApiRequestInsert(event, enrichment)).toMatchObject({
      appId: 'app-1',
      endpointId: 'endpoint-1',
      path: '/sanitized',
      routeTemplate: '/template',
      clockSkewMs: 42,
      kind: 'http',
      requestBytes: null,
      responseBytes: null,
      errorCode: null,
      release: null,
      requestId: null,
      sessionId: null,
      pageViewId: null,
    });
  });
});
