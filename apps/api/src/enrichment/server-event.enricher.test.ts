import { ERROR_CODES, INGEST_LIMITS, serverEventSchema, type ServerEvent } from '@nexus/shared';
import { toEndpointId } from '@nexus/shared/endpoint-id';
import { describe, expect, it, vi } from 'vitest';

import { fake, ingestContext, serverEvent, verhoeffAadhaar } from '../../test/ingest-fixtures';
import type { SsoIdentityReader } from '../auth/sso-identity.reader';
import { GeoIpEnricher, type GeoIpModule } from './geo-ip.enricher';
import { IdentityResolver } from './identity.resolver';
import { IpAnonymizer } from './ip.anonymizer';
import { PathSanitizer } from './path.sanitizer';
import { PiiScrubber } from './pii.scrubber';
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
    new IdentityResolver(fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'no-cookie' }) })),
    new UserKeyHasher('u'.repeat(64)),
    new PiiScrubber(),
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
    const { row, warnings } = enricher.enrich(event, ctx, 1500, 'prod');

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
    const { row } = build().enricher.enrich(parsed({ path: '/api/orders/98765432?x=1' }), ingestContext(), null, 'prod');
    expect(row.routeTemplate).toBe('/api/orders/:num');
    expect(row.endpointId).toBe(toEndpointId('ebo-sales', 'GET', '/api/orders/:num'));
  });

  it('resolves geo from the FULL ip even when storage truncates or drops it', () => {
    for (const mode of ['truncated', 'hashed'] as const) {
      const { enricher, geoModule } = build(mode);
      const { row } = enricher.enrich(parsed({ ip: '49.36.1.77' }), ingestContext(), null, 'prod');
      expect(geoModule.lookup).toHaveBeenCalledWith('49.36.1.77');
      expect(row.geoCity).toBe('Mumbai');
      expect(row.ip).toBe(mode === 'truncated' ? '49.36.1.0' : null);
      expect(row.ipHash).not.toBeNull();
    }
  });

  it('a missing email and ip produce an anonymous row without warnings', () => {
    const { row, warnings } = build().enricher.enrich(parsed(), ingestContext(), null, 'prod');
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
      'prod',
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
    const { row } = build().enricher.enrich(parsed(), ingestContext({ sdk: 's'.repeat(200) }), null, 'prod');
    expect(row.sdk).toHaveLength(INGEST_LIMITS.maxSdkNameLength);
  });

  it('lower-cases correlation ids', () => {
    const { row } = build().enricher.enrich(
      parsed({ sessionId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE', pageViewId: 'BBBBBBBB-BBBB-4CCC-8DDD-EEEEEEEEEEEE' }),
      ingestContext(),
      null,
      'prod',
    );
    expect(row.sessionId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(row.pageViewId).toBe('bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('stores the batch environment on the row', () => {
    const { row } = build().enricher.enrich(parsed(), ingestContext(), null, 'staging');
    expect(row.environment).toBe('staging');
  });
});

describe('ServerEventEnricher.enrichEnvelope', () => {
  it.each([
    [null, 'prod', []],
    ['staging', 'staging', []],
    ['qa', 'prod', [{ field: 'environment', code: ERROR_CODES.FIELD_DROPPED }]],
  ] as const)('claim %s → %s', (claim, environment, warnings) => {
    expect(build().enricher.enrichEnvelope(ingestContext({ environmentClaim: claim }))).toEqual({
      environment,
      warnings,
    });
  });
});

describe('ServerEventEnricher PII (ADR 0010)', () => {
  const { enricher } = build();
  const enrich = (overrides: Parameters<typeof serverEvent>[0]) =>
    enricher.enrich(parsed(overrides), ingestContext(), null, 'prod');

  it('a bare mobile in the path: stored /customers/:phone, endpoint id unchanged', () => {
    const phone = enrich({ path: '/ebo-sales/customers/9876543210' });
    const other = enrich({ path: '/ebo-sales/customers/1234567890' });
    expect(phone.row.path).toBe('/ebo-sales/customers/:phone');
    expect(other.row.path).toBe('/ebo-sales/customers/1234567890');
    expect(phone.row.endpointId).toBe(other.row.endpointId);
    expect(phone.row.routeTemplate).toBe('/ebo-sales/customers/:num');
    expect(phone.piiFindings).toEqual([{ field: 'path', kind: 'phone' }]);
    expect(phone.warnings).toEqual([{ field: 'path', code: ERROR_CODES.FIELD_REDACTED }]);
    expect(other.piiFindings).toEqual([]);
  });

  it('an email in the path and template is replaced BEFORE the endpoint id is computed', () => {
    const { row, piiFindings } = enrich({
      path: '/ebo-sales/users/amit@libas.in',
      routeTemplate: '/ebo-sales/users/amit@libas.in',
    });
    expect(row.path).toBe('/ebo-sales/users/:email');
    expect(row.routeTemplate).toBe('/ebo-sales/users/:email');
    expect(row.endpointId).toBe(toEndpointId('ebo-sales', 'GET', '/ebo-sales/users/:email'));
    expect(piiFindings).toEqual([
      { field: 'path', kind: 'email' },
      { field: 'route_template', kind: 'email' },
    ]);
    expect(JSON.stringify(row)).not.toContain('amit');
  });

  it('a Verhoeff-valid 12-digit segment is stored as :aadhaar', () => {
    const { row } = enrich({ path: `/ebo-sales/kyc/${verhoeffAadhaar()}` });
    expect(row.path).toBe('/ebo-sales/kyc/:aadhaar');
  });

  it('errorCode / requestId / release carrying PII are dropped whole', () => {
    const { row, warnings, piiFindings } = enrich({
      errorCode: 'PAN_ABCPE1234F',
      requestId: 'req-+91-9876543210',
      release: 'build-for-a@b.com',
    });
    expect(row).toMatchObject({ errorCode: null, requestId: null, release: null });
    expect(piiFindings).toEqual([
      { field: 'error_code', kind: 'pan' },
      { field: 'request_id', kind: 'phone' },
      { field: 'release', kind: 'email' },
    ]);
    expect(warnings.map((w) => [w.field, w.code])).toEqual([
      ['errorCode', ERROR_CODES.FIELD_REDACTED],
      ['requestId', ERROR_CODES.FIELD_REDACTED],
      ['release', ERROR_CODES.FIELD_REDACTED],
    ]);
  });

  it('a 10-digit run inside a hex request id or a git-sha release is not a phone (kept)', () => {
    const requestId = 'a1b2c3d4e5f6a7b89876543210abcdef';
    const release = '9876543210abcdef9876543210abcdef01234567';
    const { row, warnings, piiFindings } = enrich({ requestId, release });
    expect(warnings).toEqual([]);
    expect(piiFindings).toEqual([]);
    expect(row).toMatchObject({ requestId, release });
  });

  it('clean values are untouched (no false positives on ids)', () => {
    const { row, warnings, piiFindings } = enrich({
      path: '/ebo-sales/orders/5f0c1e2a-9b8d-4c7e-8f6a-1b2c3d4e5f60',
      requestId: '5f0c1e2a-9b8d-4c7e-8f6a-1b2c3d4e5f60',
      release: '2026.11.18-a1b2c3d',
      errorCode: 'VALIDATION_ERROR',
    });
    expect(warnings).toEqual([]);
    expect(piiFindings).toEqual([]);
    expect(row).toMatchObject({ release: '2026.11.18-a1b2c3d', errorCode: 'VALIDATION_ERROR' });
  });
});
