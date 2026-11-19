/**
 * Test fixtures for the ingest pipeline (rows, contexts, wire events, a silent logger).
 * WHY: one place builds valid defaults so each test states only what it varies.
 */
import { randomUUID } from 'node:crypto';

import { isVerhoeffValid, type BrowserIngestBatchInput, type ServerEventInput } from '@nexus/shared';

import type { SsoIdentityReader } from '../src/auth/sso-identity.reader';
import type { ApiKeyRow, AppRow } from '../src/domain/rows';
import type { BrowserIngestContext, IngestContext } from '../src/domain/viewer';
import { BrowserEventEnricher } from '../src/enrichment/browser-event.enricher';
import { GeoIpEnricher } from '../src/enrichment/geo-ip.enricher';
import { IdentityResolver } from '../src/enrichment/identity.resolver';
import { IpAnonymizer } from '../src/enrichment/ip.anonymizer';
import { PathSanitizer } from '../src/enrichment/path.sanitizer';
import { PiiScrubber } from '../src/enrichment/pii.scrubber';
import { RouteNormalizer } from '../src/enrichment/route.normalizer';
import { ServerEventEnricher } from '../src/enrichment/server-event.enricher';
import { UserAgentParser } from '../src/enrichment/user-agent.parser';
import { UserKeyHasher } from '../src/enrichment/user-key.hasher';
import { Logger } from '../src/lib/logger';

export const FIXED_NOW = new Date('2026-10-01T10:00:00.000Z');

export function appRow(overrides: Partial<AppRow> = {}): AppRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'ebo-sales',
    display_name: 'EBO Sales',
    base_path: '/ebo-sales',
    allowed_origins: [],
    is_active: true,
    browser_ingest_enabled: false,
    created_by: 'admin@libas.in',
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW,
    sdk_config_version: 1,
    sdk_disabled_modules: [],
    sdk_config_updated_at: null,
    ...overrides,
  };
}

export function apiKeyRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    app_id: '11111111-1111-4111-8111-111111111111',
    kind: 'secret',
    key_prefix: 'nx_sk_00000000',
    key_hash: Buffer.alloc(32),
    public_key: null,
    label: 'test',
    created_by: 'admin@libas.in',
    created_at: FIXED_NOW,
    expires_at: null,
    last_used_at: null,
    last_sdk: null,
    exposed_at: null,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
}

export function ingestContext(overrides: Partial<IngestContext> = {}): IngestContext {
  return {
    app: appRow(),
    key: apiKeyRow(),
    receivedAt: FIXED_NOW,
    sdk: null,
    environmentClaim: null,
    ...overrides,
  };
}

export function serverEvent(overrides: Partial<ServerEventInput> = {}): ServerEventInput {
  return {
    eventId: randomUUID(),
    occurredAt: '2026-10-01T09:59:58.000Z',
    method: 'GET',
    path: '/ebo-sales/api/stores',
    status: 200,
    durationMs: 12.5,
    ...overrides,
  };
}

/** A beacon context: publishable key, app with browser ingest enabled for https://ebo.libas.in. */
export function browserIngestContext(overrides: Partial<BrowserIngestContext> = {}): BrowserIngestContext {
  return {
    app: appRow({ browser_ingest_enabled: true, allowed_origins: ['https://ebo.libas.in'] }),
    key: apiKeyRow({ kind: 'publishable', key_prefix: 'nx_pk_00000000' }),
    receivedAt: FIXED_NOW,
    sdk: null,
    environmentClaim: null,
    request: { ip: null, userAgent: null, cookieHeader: undefined, origin: 'https://ebo.libas.in' },
    envelope: { replay: false },
    ...overrides,
  };
}

type BrowserEventInput = BrowserIngestBatchInput['events'][number];

/** A valid page_view (override `type` + its fields for the other event types). */
export function browserEvent(overrides: Record<string, unknown> = {}): BrowserEventInput {
  return {
    eventId: randomUUID(),
    occurredAt: '2026-10-01T09:59:58.000Z',
    seq: 0,
    type: 'page_view',
    nav: 'load',
    path: '/ebo-sales/stores',
    ...overrides,
  } as BrowserEventInput;
}

/** A logger that writes nothing (spy on its methods to assert calls). */
export function silentLogger(): Logger {
  const logger = new Logger('error');
  const mute = () => undefined;
  Object.assign(logger, { debug: mute, info: mute, warn: mute, error: mute });
  return logger;
}

/** Casts a hand-written partial fake to the concrete class it stands in for. */
export function fake<T>(implementation: Partial<T>): T {
  return implementation as T;
}

/** A real enricher wired with an empty geo database and no SSO (for service/route tests). */
export function testServerEventEnricher(): ServerEventEnricher {
  return new ServerEventEnricher(
    new PathSanitizer(),
    new RouteNormalizer(),
    new IpAnonymizer('full', 'i'.repeat(64)),
    new GeoIpEnricher(() => ({ lookup: () => null })),
    new UserAgentParser(),
    new IdentityResolver(fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'no-cookie' }) })),
    new UserKeyHasher('u'.repeat(64)),
    new PiiScrubber(),
  );
}

/** The browser twin of testServerEventEnricher (empty geo database, no SSO cookie). */
export function testBrowserEventEnricher(): BrowserEventEnricher {
  return new BrowserEventEnricher(
    new PathSanitizer(),
    new RouteNormalizer(),
    new IpAnonymizer('full', 'i'.repeat(64)),
    new GeoIpEnricher(() => ({ lookup: () => null })),
    new UserAgentParser(),
    new IdentityResolver(fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'no-cookie' }) })),
    new UserKeyHasher('u'.repeat(64)),
    new PiiScrubber(),
  );
}

/**
 * A Verhoeff-valid 12-digit number (an Aadhaar-shaped test value — not a real number): `prefix`
 * (11 digits, first one 2–9) completed with its check digit.
 */
export function verhoeffAadhaar(prefix = '23456789012'): string {
  for (let digit = 0; digit < 10; digit += 1) {
    if (isVerhoeffValid(`${prefix}${digit}`)) return `${prefix}${digit}`;
  }
  throw new Error('no Verhoeff check digit found');
}

/** The same prefix with a WRONG check digit (must NOT be detected). */
export function invalidAadhaar(prefix = '23456789012'): string {
  for (let digit = 0; digit < 10; digit += 1) {
    if (!isVerhoeffValid(`${prefix}${digit}`)) return `${prefix}${digit}`;
  }
  throw new Error('unreachable');
}
