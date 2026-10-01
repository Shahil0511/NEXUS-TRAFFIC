/**
 * Test fixtures for the ingest pipeline (rows, contexts, wire events, a silent logger).
 * WHY: one place builds valid defaults so each test states only what it varies.
 */
import { randomUUID } from 'node:crypto';

import type { ServerEventInput } from '@nexus/shared';

import type { SsoIdentityReader } from '../src/auth/sso-identity.reader';
import type { ApiKeyRow, AppRow } from '../src/domain/rows';
import type { IngestContext } from '../src/domain/viewer';
import { GeoIpEnricher } from '../src/enrichment/geo-ip.enricher';
import { IdentityResolver } from '../src/enrichment/identity.resolver';
import { IpAnonymizer } from '../src/enrichment/ip.anonymizer';
import { PathSanitizer } from '../src/enrichment/path.sanitizer';
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
  return { app: appRow(), key: apiKeyRow(), receivedAt: FIXED_NOW, sdk: null, ...overrides };
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
    new IdentityResolver(fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'none' }) })),
    new UserKeyHasher('u'.repeat(64)),
  );
}
