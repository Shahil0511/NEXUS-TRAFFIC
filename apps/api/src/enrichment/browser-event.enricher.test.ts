import {
  browserEventSchema,
  browserIngestEnvelopeSchema,
  ERROR_CODES,
  INGEST_LIMITS,
  type BrowserEvent,
  type BrowserIngestEnvelope,
} from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { browserEvent, browserIngestContext, fake } from '../../test/ingest-fixtures';
import type { SsoIdentity, SsoIdentityReader } from '../auth/sso-identity.reader';
import type { BrowserIngestContext } from '../domain/viewer';
import { BrowserEventEnricher } from './browser-event.enricher';
import { GeoIpEnricher, type GeoIpModule } from './geo-ip.enricher';
import { IdentityResolver } from './identity.resolver';
import { IpAnonymizer } from './ip.anonymizer';
import { PathSanitizer } from './path.sanitizer';
import { RouteNormalizer } from './route.normalizer';
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
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const NO_SSO: SsoIdentity = { ok: false, reason: 'none' };

function build(sso: SsoIdentity = NO_SSO) {
  const geoModule: GeoIpModule = { lookup: vi.fn(() => MUMBAI) };
  const read = vi.fn((_cookie: string | undefined) => sso);
  const userKeys = new UserKeyHasher('u'.repeat(64));
  const enricher = new BrowserEventEnricher(
    new PathSanitizer(),
    new RouteNormalizer(),
    new IpAnonymizer('full', 'i'.repeat(64)),
    new GeoIpEnricher(() => geoModule),
    new UserAgentParser(),
    new IdentityResolver(fake<SsoIdentityReader>({ read })),
    userKeys,
  );
  return { enricher, geoModule, read, userKeys };
}

function envelope(extra: Partial<BrowserIngestEnvelope> = {}): BrowserIngestEnvelope {
  return browserIngestEnvelopeSchema.parse({
    key: 'nx_pk_x',
    sentAt: '2026-10-01T09:59:59.000Z',
    sessionId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    events: [browserEvent()],
    ...extra,
  });
}

function parsed(overrides: Record<string, unknown> = {}): BrowserEvent {
  return browserEventSchema.parse(browserEvent(overrides));
}

const ctx = (overrides: Partial<BrowserIngestContext['request']> = {}) =>
  browserIngestContext({
    sdk: '@nexus/react@1.0.0',
    request: { ip: '49.36.1.1', userAgent: CHROME_UA, cookieHeader: 'access_token=jwt', ...overrides },
  });

describe('BrowserEventEnricher.enrichActor', () => {
  it('a verified SSO cookie → sso_cookie with user_email AND user_key (the hint is ignored)', () => {
    const { enricher, read, userKeys } = build({ ok: true, email: 'Saurabh@Libas.in', expiresAt: 0 });
    const { actor, warnings } = enricher.enrichActor(envelope({ user: { email: 'someone@else.in' } }), ctx());

    expect(read).toHaveBeenCalledWith('access_token=jwt');
    expect(actor).toMatchObject({
      identitySource: 'sso_cookie',
      userEmail: 'saurabh@libas.in',
      claimedEmail: null,
      userKey: userKeys.hash('saurabh@libas.in'),
    });
    expect(warnings).toEqual([]);
  });

  it('no cookie + a hint → client_claimed: claimed_email ONLY, never user_email / user_key', () => {
    const { enricher } = build();
    const { actor } = enricher.enrichActor(envelope({ user: { email: 'Hint@Libas.in' } }), ctx());
    expect(actor).toMatchObject({ identitySource: 'client_claimed', userEmail: null, userKey: null });
    expect(actor.claimedEmail).toBe('hint@libas.in');
  });

  it('no cookie, no hint → anonymous', () => {
    const { enricher } = build();
    const { actor, warnings } = enricher.enrichActor(envelope(), ctx({ cookieHeader: undefined }));
    expect(actor).toMatchObject({ identitySource: 'anonymous', userEmail: null, claimedEmail: null, userKey: null });
    expect(warnings).toEqual([]);
  });

  it('an implausible hint is dropped with a user.email warning', () => {
    const { enricher } = build();
    const { actor, warnings } = enricher.enrichActor(envelope({ user: { email: 'not-an-email' } }), ctx());
    expect(actor.identitySource).toBe('anonymous');
    expect(warnings).toEqual([{ field: 'user.email', code: ERROR_CODES.FIELD_DROPPED }]);
  });

  it('resolves geo from the full request IP, then stores the IP per mode, plus user agent and sdk', () => {
    const { enricher, geoModule } = build();
    const { actor } = enricher.enrichActor(envelope(), ctx({ ip: '::ffff:49.36.1.1' }));
    expect(geoModule.lookup).toHaveBeenCalledWith('49.36.1.1');
    expect(actor).toMatchObject({
      ip: '49.36.1.1',
      ipClass: 'public',
      geoCountry: 'IN',
      geoCity: 'Mumbai',
      uaBrowser: expect.stringContaining('Chrome'),
      sdk: '@nexus/react@1.0.0',
    });
    expect(actor.ipHash).toHaveLength(32);
  });

  it('no IP → unknown class, no geo lookup', () => {
    const { enricher, geoModule } = build();
    const { actor } = enricher.enrichActor(envelope(), ctx({ ip: null }));
    expect(actor).toMatchObject({ ip: null, ipHash: null, ipClass: 'unknown', geoCountry: null });
    expect(geoModule.lookup).not.toHaveBeenCalled();
  });
});

describe('BrowserEventEnricher.enrich', () => {
  const { enricher } = build();
  const env = envelope({ anonymousId: 'BBBBBBBB-BBBB-4CCC-8DDD-EEEEEEEEEEEE' });
  const { actor } = enricher.enrichActor(env, ctx());

  it('scrubs the path (no query), normalizes the template and carries session + actor', () => {
    const event = parsed({ path: '/ebo-sales/stores/1234567?token=secret#x', referrerPath: '/ebo-sales/home?q=1' });
    const { row, warnings } = enricher.enrich(event, env, ctx(), actor, 1000);

    expect(row).toMatchObject({
      appId: ctx().app.id,
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      anonymousId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      eventType: 'page_view',
      path: '/ebo-sales/stores/1234567',
      pathTemplate: '/ebo-sales/stores/:num',
      referrerPath: '/ebo-sales/home',
      clockSkewMs: 1000,
      identitySource: actor.identitySource,
      sdk: '@nexus/react@1.0.0',
    });
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(warnings).toEqual([]);
  });

  it('a supplied routeTemplate wins', () => {
    const event = parsed({ path: '/ebo-sales/stores/42', routeTemplate: '/ebo-sales/stores/:storeId' });
    expect(enricher.enrich(event, env, ctx(), actor, null).row.pathTemplate).toBe('/ebo-sales/stores/:storeId');
  });

  it('warns when the path or referrerPath is truncated', () => {
    const long = `/ebo-sales/${'a'.repeat(INGEST_LIMITS.maxStoredPathLength)}`;
    const { row, warnings } = enricher.enrich(parsed({ path: long, referrerPath: long }), env, ctx(), actor, null);
    expect(row.path).toHaveLength(INGEST_LIMITS.maxStoredPathLength);
    expect(warnings).toEqual([
      { field: 'path', code: ERROR_CODES.FIELD_TRUNCATED },
      { field: 'referrerPath', code: ERROR_CODES.FIELD_TRUNCATED },
    ]);
  });
});
