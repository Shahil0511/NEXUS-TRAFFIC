/**
 * Integration Health against a real, migrated database: IngestHealthRepository.perApp through
 * IntegrationService.health, connected as nexus_app on a READ-ONLY query pool.
 *
 * WHY: the unit suites prove SQL shape and the pure rules; only PostgreSQL proves the newest-event
 * scans, the counter sums (IST hour buckets), percentile_cont over clock_skew_ms, the private-IP
 * counts and the "still authenticates" filter on exposed keys.
 *
 * Dataset (all relative to the real "now", inside the partitions ensure_partitions creates):
 * - busy-app    25 server events (sdk @nexus/express@1.0.0, skew 120 ms, 24 private IPs + 1 public),
 *               2 browser page views (sdk @nexus/react@1.0.0, skew 90 000 ms); counters: server
 *               accepted 25 / rejected 2, browser rate-limited 1; one EXPOSED secret key, one
 *               exposed-but-revoked key.
 * - old-app     one server event 3 days ago (stale), nothing in the window.
 * - silent-app  nothing at all (never).
 */
import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { IntegrationHealthDto } from '@nexus/shared';

import { createQueryPool } from '../../src/db/pool';
import { FixedClock } from '../../src/lib/clock';
import { ApiKeyRepository } from '../../src/repositories/api-key.repository';
import { ApiRequestIngestRepository } from '../../src/repositories/api-request-ingest.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { IngestCounterRepository } from '../../src/repositories/ingest-counter.repository';
import { IngestHealthRepository } from '../../src/repositories/ingest-health.repository';
import { IntegrationService } from '../../src/services/integration.service';
import { apiRequestRow, sha256 } from './fixtures';
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe.skipIf(!RUN_DB_TESTS)('integration health as nexus_app on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let health: IntegrationHealthDto;
  const now = new Date();
  const ago = (ms: number) => new Date(now.getTime() - ms);

  async function newApp(slug: string): Promise<string> {
    const app = await new AppRepository(db.appPool).insert({
      slug,
      displayName: slug.toUpperCase(),
      basePath: null,
      allowedOrigins: [],
      browserIngestEnabled: true,
      createdBy: 'seed@libas.in',
    });
    return app.id;
  }

  async function newSecretKey(appId: string, suffix: string): Promise<string> {
    const key = await new ApiKeyRepository(db.appPool).insert({
      appId,
      kind: 'secret',
      keyPrefix: `nx_sk_${suffix}`,
      keyHash: sha256(suffix),
      publicKey: null,
      label: `key ${suffix}`,
      createdBy: 'seed@libas.in',
    });
    return key.id;
  }

  async function insertPageView(appId: string, at: Date, skewMs: number): Promise<void> {
    await db.ownerPool.query(
      `INSERT INTO traffic.web_events
         (occurred_at, event_id, clock_skew_ms, app_id, session_id, seq, event_type, path,
          path_template, identity_source, ip_class, sdk)
       VALUES ($1, $2, $3, $4, $5, 0, 'page_view', '/home', '/home', 'anonymous', 'unknown', $6)`,
      [at, randomUUID(), skewMs, appId, randomUUID(), '@nexus/react@1.0.0'],
    );
  }

  beforeAll(async () => {
    db = await createTestDatabase('ingest_health');
    const busy = await newApp('busy-app');
    const old = await newApp('old-app');
    await newApp('silent-app');

    const ingest = new ApiRequestIngestRepository(db.appPool);
    await ingest.insertBatch([
      ...Array.from({ length: 24 }, (_, i) =>
        apiRequestRow(busy, { occurredAt: ago((i + 1) * MINUTE), ip: '10.0.0.5', ipClass: 'private' }),
      ),
      apiRequestRow(busy, { occurredAt: ago(30 * MINUTE) }),
      apiRequestRow(old, { occurredAt: ago(3 * DAY) }),
    ]);
    await insertPageView(busy, ago(2 * MINUTE), 90_000);
    await insertPageView(busy, ago(3 * MINUTE), 90_000);

    const counters = new IngestCounterRepository(db.appPool);
    const count = (source: 'server' | 'browser', fields: Partial<Record<'accepted' | 'rejected' | 'rateLimited', number>>) =>
      counters.increment(
        { appId: busy, source, accepted: 0, duplicates: 0, rejected: 0, rateLimited: 0, ...fields },
        ago(MINUTE),
      );
    await count('server', { accepted: 25, rejected: 2 });
    await count('browser', { rateLimited: 1 });
    // Outside the window: never summed.
    await counters.increment(
      { appId: busy, source: 'server', accepted: 1000, duplicates: 0, rejected: 0, rateLimited: 0 },
      ago(3 * DAY),
    );

    const keys = new ApiKeyRepository(db.appPool);
    const exposed = await newSecretKey(busy, 'Exposed1');
    await keys.markExposed(exposed);
    const revoked = await newSecretKey(busy, 'Revoked1');
    await keys.markExposed(revoked);
    await keys.revoke(revoked, busy, 'boss@libas.in');
    await newSecretKey(busy, 'CleanKey');

    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    const service = new IntegrationService(new IngestHealthRepository(queryPool), new FixedClock(now));
    health = await service.health();
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  const appOf = (slug: string) => health.apps.find((app) => app.app === slug);

  it('lists every app in slug order with its status', () => {
    expect(health.apps.map((app) => [app.app, app.status])).toEqual([
      ['busy-app', 'healthy'],
      ['old-app', 'stale'],
      ['silent-app', 'never'],
    ]);
  });

  it('finds the newest event of each source', () => {
    const busy = appOf('busy-app');
    expect(busy?.lastServerEventAt).toBe(ago(MINUTE).toISOString());
    expect(busy?.lastBrowserEventAt).toBe(ago(2 * MINUTE).toISOString());
    expect(appOf('old-app')?.lastServerEventAt).toBe(ago(3 * DAY).toISOString());
    expect(appOf('silent-app')?.lastServerEventAt).toBeNull();
  });

  it('sums the window counters per source (the 3-day-old bucket is excluded)', () => {
    expect(appOf('busy-app')?.counters).toEqual([
      { source: 'server', accepted: 25, duplicates: 0, rejected: 2, rateLimited: 0 },
      { source: 'browser', accepted: 0, duplicates: 0, rejected: 0, rateLimited: 1 },
    ]);
  });

  it('reports each SDK with its median / worst clock skew, busiest first', () => {
    expect(appOf('busy-app')?.sdks).toEqual([
      expect.objectContaining({ source: 'server', sdk: '@nexus/express@1.0.0', events: 25, medianClockSkewMs: 120, maxAbsClockSkewMs: 120 }),
      expect.objectContaining({ source: 'browser', sdk: '@nexus/react@1.0.0', events: 2, medianClockSkewMs: 90_000 }),
    ]);
    expect(appOf('old-app')?.sdks).toEqual([]);
  });

  it('computes the private-IP share of server events and warns', () => {
    const busy = appOf('busy-app');
    expect(busy?.privateIpRatio).toBe(0.96);
    expect(busy?.warnings).toEqual(['exposed_key', 'private_ips', 'clock_skew', 'rejected_events', 'rate_limited']);
  });

  it('lists only the exposed key that still authenticates (revoked one hidden, no secrets)', () => {
    expect(appOf('busy-app')?.exposedKeys).toEqual([
      expect.objectContaining({ keyPrefix: 'nx_sk_Exposed1', label: 'key Exposed1' }),
    ]);
    expect(JSON.stringify(health)).not.toMatch(/key_hash|keyHash/);
  });
});
