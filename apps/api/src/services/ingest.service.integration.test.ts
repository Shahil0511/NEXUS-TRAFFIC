/**
 * The server ingest pipeline against a real, migrated database AS nexus_app:
 * AppKeyAuthenticator (generated key round trip, exposure flag, usage touch) → IngestService with the
 * real repositories (idempotent insert, real CHECK violation bisect, missing-partition recovery).
 */
import { randomUUID } from 'node:crypto';

import { ERROR_CODES, type ServerIngestEnvelope } from '@nexus/shared';
import type { Lookup } from 'geoip-lite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  fake,
  serverEvent,
  silentLogger,
  testBrowserEventEnricher,
} from '../../test/ingest-fixtures';
import {
  RUN_DB_TESTS,
  createTestDatabase,
  partitionName,
  utcMonthStart,
  type TestDatabase,
} from '../../test/db/test-database';
import { ApiKeyGenerator } from '../auth/api-key.generator';
import { ApiKeyHasher } from '../auth/api-key.hasher';
import { AppKeyAuthenticator } from '../auth/app-key.authenticator';
import { AppKeyCache } from '../auth/app-key.cache';
import type { SsoIdentityReader } from '../auth/sso-identity.reader';
import type { AppRow } from '../domain/rows';
import type { AuthenticatedKey } from '../domain/viewer';
import { EventTimeGuard } from '../enrichment/event-time.guard';
import { GeoIpEnricher } from '../enrichment/geo-ip.enricher';
import { IdentityResolver } from '../enrichment/identity.resolver';
import { IpAnonymizer } from '../enrichment/ip.anonymizer';
import { PathSanitizer } from '../enrichment/path.sanitizer';
import { RouteNormalizer } from '../enrichment/route.normalizer';
import { ServerEventEnricher } from '../enrichment/server-event.enricher';
import { UserAgentParser } from '../enrichment/user-agent.parser';
import { UserKeyHasher } from '../enrichment/user-key.hasher';
import { SystemClock } from '../lib/clock';
import { LiveBroadcaster } from '../live/live.broadcaster';
import { LiveFeed } from '../live/live-feed';
import { LiveWindow } from '../live/live-window';
import { ApiKeyRepository } from '../repositories/api-key.repository';
import { ApiRequestIngestRepository } from '../repositories/api-request-ingest.repository';
import { AppRepository } from '../repositories/app.repository';
import { IngestCounterRepository } from '../repositories/ingest-counter.repository';
import { PartitionRepository } from '../repositories/partition.repository';
import { WebEventIngestRepository } from '../repositories/web-event-ingest.repository';
import { IngestService } from './ingest.service';

/** This IP "geolocates" to an invalid lower-case country → violates api_requests_geo_country_check. */
const POISON_IP = '203.0.113.66';

function poisonGeo(): GeoIpEnricher {
  const hit = { country: 'zz', region: '', city: '', ll: [0, 0] } as unknown as Lookup;
  return new GeoIpEnricher(() => ({ lookup: (ip) => (ip === POISON_IP ? hit : null) }));
}

describe.skipIf(!RUN_DB_TESTS)('server ingest pipeline (db)', () => {
  let db: TestDatabase;
  let app: AppRow;
  let keys: ApiKeyRepository;
  let authenticator: AppKeyAuthenticator;
  let service: IngestService;
  let liveFeed: LiveFeed;
  let secretKey: string;
  let auth: AuthenticatedKey;
  const hasher = new ApiKeyHasher('p'.repeat(64));
  const clock = new SystemClock();

  beforeAll(async () => {
    db = await createTestDatabase('ingest_pipeline');
    const apps = new AppRepository(db.appPool);
    keys = new ApiKeyRepository(db.appPool);
    app = await apps.insert({
      slug: 'ebo-sales',
      displayName: 'EBO Sales',
      basePath: '/ebo-sales',
      allowedOrigins: [],
      browserIngestEnabled: false,
      createdBy: 'admin@libas.in',
    });
    const generated = new ApiKeyGenerator(hasher).generate('secret');
    await keys.insert({
      appId: app.id,
      kind: generated.kind,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      publicKey: generated.publicKey,
      label: 'integration',
      createdBy: 'admin@libas.in',
    });
    secretKey = generated.plaintext;
    authenticator = new AppKeyAuthenticator(
      keys,
      apps,
      hasher,
      new AppKeyCache(clock),
      clock,
      silentLogger(),
    );

    const liveWindow = new LiveWindow();
    liveFeed = new LiveFeed(liveWindow, new LiveBroadcaster(liveWindow), clock);
    const enricher = new ServerEventEnricher(
      new PathSanitizer(),
      new RouteNormalizer(),
      new IpAnonymizer('full', 'i'.repeat(64)),
      poisonGeo(),
      new UserAgentParser(),
      new IdentityResolver(
        fake<SsoIdentityReader>({ read: () => ({ ok: false, reason: 'none' }) }),
      ),
      new UserKeyHasher('u'.repeat(64)),
    );
    service = new IngestService(
      new ApiRequestIngestRepository(db.appPool),
      new WebEventIngestRepository(db.appPool),
      new IngestCounterRepository(db.appPool),
      new PartitionRepository(db.appPool),
      enricher,
      testBrowserEventEnricher(),
      new EventTimeGuard(),
      liveFeed,
      silentLogger(),
    );
    auth = await authenticator.authenticate(secretKey, 'secret', '@nexus/express@1.0.0');
  });

  afterAll(async () => {
    await db?.drop();
  });

  function recentEvent(overrides: Parameters<typeof serverEvent>[0] = {}) {
    return serverEvent({ occurredAt: new Date(Date.now() - 1000).toISOString(), ...overrides });
  }

  function ingest(events: unknown[], dryRun = false) {
    const envelope: ServerIngestEnvelope = { sentAt: new Date().toISOString(), events };
    return service.ingestServerEvents(
      envelope,
      { ...auth, receivedAt: clock.now(), sdk: 'it@1' },
      { dryRun },
    );
  }

  it('authenticates a generated key and records its usage', async () => {
    expect(auth.app.id).toBe(app.id);
    await vi.waitFor(async () => {
      const { rows } = await db.appPool.query(
        `SELECT last_used_at, last_sdk FROM traffic.api_keys WHERE id = $1`,
        [auth.key.id],
      );
      expect(rows[0]).toMatchObject({ last_sdk: '@nexus/express@1.0.0' });
      expect(rows[0].last_used_at).toBeInstanceOf(Date);
    });
  });

  it('a secret key on the browser endpoint is flagged exposed in the database', async () => {
    await expect(authenticator.authenticate(secretKey, 'publishable')).rejects.toMatchObject({
      code: ERROR_CODES.SECRET_KEY_EXPOSED,
    });
    const { rows } = await db.appPool.query(
      `SELECT exposed_at FROM traffic.api_keys WHERE id = $1`,
      [auth.key.id],
    );
    expect(rows[0].exposed_at).toBeInstanceOf(Date);
  });

  it('stores a batch with mapped columns and reports a resend as duplicates', async () => {
    const events = [
      recentEvent({
        status: 404,
        ip: '::ffff:49.36.1.1',
        userEmail: 'Saurabh@Libas.in',
        path: '/ebo-sales/api/x?t=1',
      }),
      recentEvent(),
    ];
    expect(await ingest(events)).toEqual({
      accepted: 2,
      duplicates: 0,
      rejected: [],
      warnings: [],
    });
    expect(await ingest(events)).toMatchObject({ accepted: 0, duplicates: 2 });

    const { rows } = await db.appPool.query(
      `SELECT status_code, path, host(ip) AS ip, user_email, octet_length(user_key) AS key_len, identity_source, sdk
         FROM traffic.api_requests WHERE event_id = $1`,
      [events[0]!.eventId],
    );
    expect(rows[0]).toEqual({
      status_code: 404,
      path: '/ebo-sales/api/x',
      ip: '49.36.1.1',
      user_email: 'saurabh@libas.in',
      key_len: 32,
      identity_source: 'app_attested',
      sdk: 'it@1',
    });
  });

  it('bisects around a row the database rejects and keeps its original index', async () => {
    const events = [
      recentEvent(),
      recentEvent(),
      recentEvent({ ip: POISON_IP }),
      recentEvent(),
      recentEvent(),
    ];
    const record = vi.spyOn(liveFeed, 'recordApiRequests');
    const result = await ingest([{ bogus: true }, ...events]);

    expect(result.accepted).toBe(4);
    expect(result.rejected.map((r) => [r.index, r.code])).toEqual([
      [0, ERROR_CODES.INVALID_EVENT],
      [3, ERROR_CODES.DB_CONSTRAINT],
    ]);
    const { rows } = await db.appPool.query(
      `SELECT count(*)::int AS n FROM traffic.api_requests WHERE event_id = ANY($1)`,
      [events.map((e) => e.eventId)],
    );
    expect(rows[0].n).toBe(4);
    expect(record.mock.calls.at(-1)?.[1]).toHaveLength(4);
  });

  it('dryRun writes nothing', async () => {
    const event = recentEvent();
    expect(await ingest([event], true)).toMatchObject({ accepted: 1, dryRun: true });
    const { rows } = await db.appPool.query(
      `SELECT 1 FROM traffic.api_requests WHERE event_id = $1`,
      [event.eventId],
    );
    expect(rows).toHaveLength(0);
  });

  it('recreates a missing partition and retries the insert', async () => {
    const current = partitionName('api_requests', utcMonthStart(new Date()));
    await db.ownerPool.query(`DROP TABLE traffic.${current}`);
    const event = recentEvent({ eventId: randomUUID() });

    expect(await ingest([event])).toMatchObject({ accepted: 1, rejected: [] });
    const { rows } = await db.appPool.query<{ partition: string }>(
      `SELECT c.relname AS partition FROM traffic.api_requests r JOIN pg_class c ON c.oid = r.tableoid
        WHERE r.event_id = $1`,
      [event.eventId],
    );
    expect(rows[0]?.partition).toBe(current);
  });
});
