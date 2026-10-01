import { ERROR_CODES, INGEST_LIMITS, serverEventSchema, type ServerEvent } from '@nexus/shared';
import { toEndpointId } from '@nexus/shared/endpoint-id';
import { describe, expect, it, vi } from 'vitest';

import { fake, ingestContext, serverEvent } from '../../test/ingest-fixtures';
import type { SsoIdentityReader } from '../auth/sso-identity.reader';
import { GeoIpEnricher, type GeoIpModule } from './geo-ip.enricher';
import { IdentityResolver } from './identity.resolver';
import { IpAnonymizer } from './ip.anonymizer';
import { PathSanitizer } from './path.sanitizer';
import { RouteNormalizer } from './route.normalizer';
import { ServerEventEnricher } from './server-event.enricher';
import { UserAgentParser } from './user-agent.parser';
import { UserKeyHasher } from './user-key.hasher';

const MUMBAI = {
  range: [0, 0] as [number, number],
  country: 'IN',
  region: 'MH',
  city: 'Mumbai',
  eu: '0' as const,
  timezone: 'Asia/Kolkata',
  ll: [19.0748, 72.8856] as [number, number],
  metro: 0,
  area: 20,
};

function build(mode: 'full' | 'truncated' | 'hashed' = 'full') {
  const geoModule: GeoIpModule = { lookup: vi.fn(() => MUMBAI) };
  const enricher = new ServerEventEnricher(
    new PathSanitizer(),
    new RouteNormalizer(),
    new IpAnonymizer(mode, 'i'.repeat(64)),
    new GeoIpEnricher(() => geoModule),
    new UserAgentParser(),
    new IdentityResolver(fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'n/a' }) })),
    new UserKeyHasher('u'.repeat(64)),
  );
  return { enricher, geoModule };
}

function parsed(overrides: Parameters<typeof serverEvent>[0] = {}): ServerEvent {
  return serverEventSchema.parse(serverEvent(overrides));
}

describe('ServerEventEnricher', () => {
  it('enriches a full event into an insert row', () => {
    const { enricher } = build();
    const event = parsed({
      eventId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
      path: '/ebo-sales/api/stores/1234567?token=secret',
      routeTemplate: '/ebo-sales/api/stores/:id',
      method: 'post',
      status: 201,
      ip: '49.36.1.1',
      userEmail: 'Saurabh@Libas.in',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      requestId: 'req-1',
      errorCode: 'VALIDATION_ERROR',
      release: '1.2.3',
      kind: 'stream',
      requestBytes: 10,
      responseBytes: 20,
    });
    const ctx = ingestContext({ sdk: '@nexus/express@1.0.0' });
    const { row, warnings } = enricher.enrich(event, ctx, 1500);

    expect(warnings).toEqual([]);
    expect(row).toMatchObject({
      occurredAt: new Date(event.occurredAt),
      eventId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      clockSkewMs: 1500,
      appId: ctx.app.id,
      endpointId: toEndpointId(ctx.app.slug, 'POST', '/ebo-sales/api/stores/:id'),
      kind: 'stream',
      method: 'POST',
      routeTemplate: '/ebo-sales/api/stores/:id',
      path: '/ebo-sales/api/stores/1234567',
      statusCode: 201,
      durationMs: 12.5,
      requestBytes: 10,
      responseBytes: 20,
      errorCode: 'VALIDATION_ERROR',
      release: '1.2.3',
      requestId: 'req-1',
      sessionId: null,
      pageViewId: null,
      userEmail: 'saurabh@libas.in',
      claimedEmail: null,
      identitySource: 'app_attested',
      ip: '49.36.1.1',
      ipClass: 'public',
      geoCountry: 'IN',
      geoRegion: 'MH',
      geoCity: 'Mumbai',
      geoLat: 19.1,
      geoLon: 72.9,
      uaBrowser: 'Chrome 126',
      uaOs: 'Windows 10',
      uaDevice: 'desktop',
      sdk: '@nexus/express@1.0.0',
    });
    expect(row.userKey).toHaveLength(32);
    expect(row.ipHash).toHaveLength(32);
  });

  it('derives the route template from the sanitized path when none is supplied', () => {
    const { row } = build().enricher.enrich(parsed({ path: '/api/orders/98765432?x=1' }), ingestContext(), null);
    expect(row.routeTemplate).toBe('/api/orders/:num');
    expect(row.endpointId).toBe(toEndpointId('ebo-sales', 'GET', '/api/orders/:num'));
  });

  it('resolves geo from the FULL ip even when storage truncates or drops it', () => {
    for (const mode of ['truncated', 'hashed'] as const) {
      const { enricher, geoModule } = build(mode);
      const { row } = enricher.enrich(parsed({ ip: '49.36.1.77' }), ingestContext(), null);
      expect(geoModule.lookup).toHaveBeenCalledWith('49.36.1.77');
      expect(row.geoCity).toBe('Mumbai');
      expect(row.ip).toBe(mode === 'truncated' ? '49.36.1.0' : null);
      expect(row.ipHash).not.toBeNull();
    }
  });

  it('a missing email and ip produce an anonymous row without warnings', () => {
    const { row, warnings } = build().enricher.enrich(parsed(), ingestContext(), null);
    expect(warnings).toEqual([]);
    expect(row).toMatchObject({
      userEmail: null,
      userKey: null,
      identitySource: 'anonymous',
      ip: null,
      ipHash: null,
      ipClass: 'unknown',
      geoCountry: null,
      uaBrowser: null,
      sdk: null,
    });
  });

  it('reports soft problems as warnings and still produces the row', () => {
    const { row, warnings } = build().enricher.enrich(
      parsed({
        path: `/${'p'.repeat(INGEST_LIMITS.maxStoredPathLength + 10)}`,
        ip: 'not-an-ip',
        userEmail: 'nobody',
        userAgent: 'x'.repeat(INGEST_LIMITS.maxUserAgentStoredLength + 1),
      }),
      ingestContext(),
      null,
    );
    expect(warnings).toEqual([
      { field: 'path', code: ERROR_CODES.FIELD_TRUNCATED },
      { field: 'ip', code: ERROR_CODES.FIELD_DROPPED },
      { field: 'userEmail', code: ERROR_CODES.FIELD_DROPPED },
      { field: 'userAgent', code: ERROR_CODES.FIELD_TRUNCATED },
    ]);
    expect(row.path).toHaveLength(INGEST_LIMITS.maxStoredPathLength);
    expect(row.ip).toBeNull();
    expect(row.userEmail).toBeNull();
  });

  it('truncates the sdk label to 64 characters', () => {
    const { row } = build().enricher.enrich(parsed(), ingestContext({ sdk: 's'.repeat(200) }), null);
    expect(row.sdk).toHaveLength(INGEST_LIMITS.maxSdkNameLength);
  });

  it('lower-cases correlation ids', () => {
    const { row } = build().enricher.enrich(
      parsed({ sessionId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', pageViewId: 'BBBBBBBB-BBBB-4CCC-8DDD-EEEEEEEEEEEE' }),
      ingestContext(),
      null,
    );
    expect(row.sessionId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(row.pageViewId).toBe('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });
});
