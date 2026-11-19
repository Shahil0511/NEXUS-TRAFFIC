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
import { PiiScrubber } from './pii.scrubber';
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
const NO_SSO: SsoIdentity = { ok: false, reason: 'no-cookie' };

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
    new PiiScrubber(),
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

const ctx = (
  overrides: Partial<BrowserIngestContext['request']> = {},
  extra: Partial<BrowserIngestContext> = {},
) =>
  browserIngestContext({
    sdk: '@nexus/react@1.0.0',
    request: {
      ip: '49.36.1.1',
      userAgent: CHROME_UA,
      cookieHeader: 'access_token=jwt',
      origin: 'https://ebo.libas.in',
      ...overrides,
    },
    ...extra,
  });

describe('BrowserEventEnricher.enrichActor', () => {
  it('a verified SSO cookie → sso_cookie with user_email AND user_key (the hint is ignored)', () => {
    const { enricher, read, userKeys } = build({ ok: true, email: 'Saurabh@Libas.in', expiresAt: 0 });
    const { actor, warnings } = enricher.enrichActor(envelope({ user: { email: 'someone@else.in' } }), ctx());

    expect(read).toHaveBeenCalledWith('access_token=jwt');
    expect(enricher.enrichActor(envelope(), ctx()).ssoOutcome).toBe('ok');
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
  const batch = enricher.enrichActor(env, ctx());
  const { actor } = batch;

  it('scrubs the path (no query), normalizes the template and carries session + actor', () => {
    const event = parsed({ path: '/ebo-sales/stores/1234567?token=secret#x', referrerPath: '/ebo-sales/home?q=1' });
    const { row, warnings } = enricher.enrich(event, env, ctx(), batch, 1000);

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
    expect(enricher.enrich(event, env, ctx(), batch, null).row.pathTemplate).toBe('/ebo-sales/stores/:storeId');
  });

  it('warns when the path or referrerPath is truncated', () => {
    const long = `/ebo-sales/${'a'.repeat(INGEST_LIMITS.maxStoredPathLength)}`;
    const { row, warnings } = enricher.enrich(parsed({ path: long, referrerPath: long }), env, ctx(), batch, null);
    expect(row.path).toHaveLength(INGEST_LIMITS.maxStoredPathLength);
    expect(warnings).toEqual([
      { field: 'path', code: ERROR_CODES.FIELD_TRUNCATED },
      { field: 'referrerPath', code: ERROR_CODES.FIELD_TRUNCATED },
    ]);
  });

  it('stores the batch envelope columns on every row', () => {
    const { row } = enricher.enrich(parsed(), env, ctx(), batch, null);
    expect(row).toMatchObject({ environment: 'prod', clientTz: null, clientLang: null, release: null });
  });
});

describe('BrowserEventEnricher envelope columns (environment, tz, lang, release)', () => {
  const { enricher } = build();

  it('valid values are kept', () => {
    const batch = enricher.enrichActor(
      envelope(),
      ctx(
        {},
        {
          environmentClaim: 'staging',
          envelope: { tz: 'Asia/Kolkata', lang: 'en-IN', release: '2026.11.18-a1b2c3d', replay: false },
        },
      ),
    );
    expect(batch.envelope).toEqual({
      environment: 'staging',
      clientTz: 'Asia/Kolkata',
      clientLang: 'en-IN',
      release: '2026.11.18-a1b2c3d',
    });
    expect(batch.warnings).toEqual([]);
  });

  it('a localhost origin overrides a prod claim → dev', () => {
    const batch = enricher.enrichActor(envelope(), ctx({ origin: 'http://localhost:3000' }, { environmentClaim: 'prod' }));
    expect(batch.envelope.environment).toBe('dev');
    expect(batch.warnings).toEqual([]);
  });

  it('unknown environment, bad tz and bad lang are dropped with FIELD_DROPPED', () => {
    const batch = enricher.enrichActor(
      envelope(),
      ctx(
        {},
        { environmentClaim: 'production', envelope: { tz: 'not a zone!', lang: 'english please', replay: false } },
      ),
    );
    expect(batch.envelope).toMatchObject({ environment: 'prod', clientTz: null, clientLang: null });
    expect(batch.warnings).toEqual([
      { field: 'environment', code: ERROR_CODES.FIELD_DROPPED },
      { field: 'client.tz', code: ERROR_CODES.FIELD_DROPPED },
      { field: 'client.lang', code: ERROR_CODES.FIELD_DROPPED },
    ]);
  });

  it('a release carrying PII is dropped (FIELD_REDACTED once) and counted on every row', () => {
    const env = envelope();
    const batch = enricher.enrichActor(env, ctx({}, { envelope: { release: 'v1-+919876543210', replay: false } }));
    expect(batch.envelope.release).toBeNull();
    expect(batch.warnings).toEqual([{ field: 'release', code: ERROR_CODES.FIELD_REDACTED }]);
    const { warnings, piiFindings } = enricher.enrich(parsed(), env, ctx(), batch, null);
    expect(warnings).toEqual([]);
    expect(piiFindings).toEqual([{ field: 'release', kind: 'phone' }]);
  });

  it('a replay never reads the SSO cookie and reports no outcome', () => {
    const { enricher: withSso, read } = build({ ok: true, email: 'person@example.com', expiresAt: 0 });
    const batch = withSso.enrichActor(envelope(), ctx({}, { envelope: { replay: true } }));
    expect(read).not.toHaveBeenCalled();
    expect(batch.actor).toMatchObject({ identitySource: 'anonymous', userEmail: null });
    expect(batch.ssoOutcome).toBeNull();
  });
});

describe('BrowserEventEnricher route template guard (A1)', () => {
  const { enricher } = build();
  const env = envelope();
  const batch = enricher.enrichActor(env, ctx());

  it('keeps a plausible template', () => {
    const { row, warnings } = enricher.enrich(
      parsed({ path: '/ebo-sales/orders/42', routeTemplate: '/ebo-sales/orders/:orderId' }),
      env,
      ctx(),
      batch,
      null,
    );
    expect(row.pathTemplate).toBe('/ebo-sales/orders/:orderId');
    expect(warnings).toEqual([]);
  });

  it('drops an implausible template (FIELD_DROPPED) and falls back to guessing', () => {
    const { row, warnings } = enricher.enrich(
      parsed({ path: '/ebo-sales/orders/1234567', routeTemplate: '/ebo-sales/customers/:id' }),
      env,
      ctx(),
      batch,
      null,
    );
    expect(row.pathTemplate).toBe('/ebo-sales/orders/:num');
    expect(warnings).toEqual([{ field: 'routeTemplate', code: ERROR_CODES.FIELD_DROPPED }]);
  });
});

describe('BrowserEventEnricher PII (ADR 0010)', () => {
  const { enricher } = build();
  const env = envelope();
  const batch = enricher.enrichActor(env, ctx());
  const enrich = (overrides: Record<string, unknown>) => enricher.enrich(parsed(overrides), env, ctx(), batch, null);

  it('/customers/9876543210 is stored as /customers/:phone; the page template is unchanged', () => {
    const phone = enrich({ path: '/ebo-sales/customers/9876543210', referrerPath: '/ebo-sales/customers/9123456789' });
    const other = enrich({ path: '/ebo-sales/customers/1234567890' });
    expect(phone.row.path).toBe('/ebo-sales/customers/:phone');
    expect(phone.row.referrerPath).toBe('/ebo-sales/customers/:phone');
    expect(phone.row.pathTemplate).toBe(other.row.pathTemplate);
    expect(other.row.path).toBe('/ebo-sales/customers/1234567890');
    expect(phone.piiFindings).toEqual([
      { field: 'path', kind: 'phone' },
      { field: 'referrer_path', kind: 'phone' },
    ]);
    expect(phone.warnings).toEqual([
      { field: 'path', code: ERROR_CODES.FIELD_REDACTED },
      { field: 'referrerPath', code: ERROR_CODES.FIELD_REDACTED },
    ]);
  });

  it('tool_use: tool → redacted, label replaced, PII prop keys dropped, prop values replaced', () => {
    const { row, piiFindings, warnings } = enrich({
      type: 'tool_use',
      tool: 'call-9876543210',
      label: 'Call +91 9876543210',
      props: { mobile9876543210: true, note: 'mail x@y.co', rows: 3 },
    });
    expect(row).toMatchObject({
      tool: 'call-redacted',
      label: 'Call :phone',
      props: { note: 'mail :email', rows: 3 },
    });
    expect(piiFindings).toEqual([
      { field: 'tool', kind: 'phone' },
      { field: 'label', kind: 'phone' },
      { field: 'prop_key', kind: 'phone' },
      { field: 'prop_value', kind: 'email' },
    ]);
    expect(warnings).toEqual([
      { field: 'tool', code: ERROR_CODES.FIELD_REDACTED },
      { field: 'label', code: ERROR_CODES.FIELD_REDACTED },
      { field: 'props', code: ERROR_CODES.FIELD_REDACTED },
    ]);
  });

  it('custom: name scrubbed; all props dropped → null', () => {
    const { row } = enrich({ type: 'custom', name: 'otp.abcpe1234f', props: { pan_abcpe1234f: 'x' } });
    expect(row).toMatchObject({ name: 'otp.redacted', props: null });
  });

  it('no false positives on normal events', () => {
    const { warnings, piiFindings } = enrich({
      type: 'tool_use',
      tool: 'audits.export-csv',
      label: 'Export 12345 rows',
      props: { order_id: '5f0c1e2a-9b8d-4c7e-8f6a-1b2c3d4e5f60', count: 9876543210 },
    });
    expect(warnings).toEqual([]);
    expect(piiFindings).toEqual([]);
  });
});
