/**
 * S1 end to end, in process: the REAL container (createContainer) and app (createApp) against a
 * fresh, migrated database, connected as nexus_app exactly like production.
 *
 * WHY: unit tests prove each piece; this proves the wiring. An admin creates an app and keys through
 * the dashboard routes (SSO cookie + X-Nexus-Dashboard), then the public ingest contract is driven
 * over HTTP the way other teams' middleware will call it: accept, dedupe on resend, dry run, the
 * key error branches, verify, health, and the stored row shape (endpoint_id, user_key, geo).
 */
import { randomUUID } from 'node:crypto';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  buildPath,
  ERROR_CODES,
  INGEST_HEADERS,
  ROUTES,
  SERVER_BATCH_EXAMPLE,
  type AppDto,
  type IngestResultDto,
  type KeyCreatedDto,
  type KeyKind,
} from '@nexus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../../src/app';
import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { createTestDatabase, RUN_DB_TESTS, type TestDatabase } from '../db/test-database';
import { signAccessToken } from '../fixtures/sign-access-token';
import { silentLogger } from '../ingest-fixtures';

const JWT_SECRET = 'e2e-jwt-secret-'.padEnd(48, 'x');
const ADMIN_EMAIL = 'admin@libas.in';
const APP_SLUG = 'ebo-sales';
/** A public IP that geoip-lite resolves (203.0.113.24 in the example is TEST-NET: no geo). */
const GEO_IP = '8.8.8.8';
const DRY_RUN_QUERY = { dryRun: '1' } as const;

const url = (path: string) => `${API_MOUNT_PATH}${path}`;

function testConfig(databaseUrl: string) {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: databaseUrl,
    LIBAS_JWT_SECRET: JWT_SECRET,
    DASHBOARD_ADMIN_EMAILS: ADMIN_EMAIL,
    API_KEY_PEPPER: 'a'.repeat(64),
    USER_KEY_SECRET: 'b'.repeat(64),
    IP_HASH_SECRET: 'c'.repeat(64),
  });
}

function adminCookie(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email: ADMIN_EMAIL, type: 'access', exp }, JWT_SECRET)}`;
}

/** SERVER_BATCH_EXAMPLE with fresh event ids and timestamps inside the accepted time window. */
function freshBatch(overrides: { ip?: string } = {}) {
  const now = Date.now();
  return {
    ...SERVER_BATCH_EXAMPLE,
    sentAt: new Date(now).toISOString(),
    events: SERVER_BATCH_EXAMPLE.events.map((event, i) => ({
      ...event,
      eventId: randomUUID(),
      occurredAt: new Date(now - 1000 + i).toISOString(),
      ...(overrides.ip ? { ip: overrides.ip } : {}),
    })),
  };
}

describe.skipIf(!RUN_DB_TESTS)('S1 e2e: admin → server ingest over HTTP (db)', () => {
  let db: TestDatabase;
  let container: Container;
  let app: Express;
  let secretKey: string;
  let publishableKey: string;

  async function createKey(kind: KeyKind): Promise<string> {
    const res = await request(app)
      .post(url(buildPath(ROUTES.apps.createKey, { slug: APP_SLUG })))
      .set('Cookie', adminCookie())
      .set(INGEST_HEADERS.dashboard, '1')
      .send({ kind, label: `e2e ${kind}` });
    expect(res.status).toBe(201);
    return (res.body as KeyCreatedDto).plaintextKey;
  }

  function sendServer(body: unknown, key: string, query: Record<string, string> = {}) {
    return request(app)
      .post(url(ROUTES.ingest.server.path))
      .query(query)
      .set(INGEST_HEADERS.key, key)
      .send(body as object);
  }

  async function countRows(): Promise<number> {
    const { rows } = await db.ownerPool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM traffic.api_requests',
    );
    return Number(rows[0]?.n);
  }

  beforeAll(async () => {
    db = await createTestDatabase('e2e_ingest');
    container = createContainer(testConfig(db.appUrl), { logger: silentLogger() });
    app = createApp(container);

    const created = await request(app)
      .post(url(ROUTES.apps.create.path))
      .set('Cookie', adminCookie())
      .set(INGEST_HEADERS.dashboard, '1')
      .send({ slug: APP_SLUG, displayName: 'EBO Sales', basePath: '/ebo-sales' });
    expect(created.status).toBe(201);
    expect((created.body as AppDto).slug).toBe(APP_SLUG);

    secretKey = await createKey('secret');
    publishableKey = await createKey('publishable');
  });

  afterAll(async () => {
    if (container)
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    await db?.drop();
  });

  // ─── Health ────────────────────────────────────────────────────────────────

  it('GET health → 200', async () => {
    const res = await request(app).get(url(ROUTES.health.live.path));
    expect(res.status).toBe(200);
  });

  it('GET health/ready → 200 (schema current, future partitions exist)', async () => {
    const res = await request(app).get(url(ROUTES.health.ready.path));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: true, schemaCurrent: true });
  });

  // ─── Verify ────────────────────────────────────────────────────────────────

  it('GET ingest/verify with the secret key → 200 with the app and key kind', async () => {
    const res = await request(app)
      .get(url(ROUTES.ingest.verify.path))
      .set(INGEST_HEADERS.key, secretKey);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ app: { slug: APP_SLUG }, keyKind: 'secret' });
  });

  // ─── Server ingest ─────────────────────────────────────────────────────────

  it('accepts the example batch (202, accepted 2), then counts the resend as duplicates', async () => {
    const batch = freshBatch();
    const first = await sendServer(batch, secretKey);
    expect(first.status).toBe(202);
    expect(first.body as IngestResultDto).toMatchObject({
      accepted: 2,
      duplicates: 0,
      rejected: [],
    });

    const resend = await sendServer({ ...batch, sentAt: new Date().toISOString() }, secretKey);
    expect(resend.status).toBe(202);
    expect(resend.body as IngestResultDto).toMatchObject({
      accepted: 0,
      duplicates: 2,
      rejected: [],
    });
  });

  it('dryRun=1 validates but writes nothing', async () => {
    const before = await countRows();
    const res = await sendServer(freshBatch(), secretKey, DRY_RUN_QUERY);
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ dryRun: true, accepted: 2 });
    expect(await countRows()).toBe(before);
  });

  it('a wrong key → 401 INVALID_API_KEY', async () => {
    const wrong = `${secretKey.slice(0, -4)}zzzz`;
    const res = await sendServer(freshBatch(), wrong);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_API_KEY);
  });

  it('a publishable key on the server endpoint → 403 WRONG_KEY_TYPE', async () => {
    const res = await sendServer(freshBatch(), publishableKey);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.WRONG_KEY_TYPE);
  });

  it('stores endpoint_id, user_key and geo (geo only for a routable IP)', async () => {
    const batch = freshBatch({ ip: GEO_IP });
    const res = await sendServer(batch, secretKey);
    expect(res.body).toMatchObject({ accepted: 2 });

    const { rows } = await db.ownerPool.query<{
      event_id: string;
      endpoint_id: string | null;
      user_key: Buffer | null;
      identity_source: string;
      geo_country: string | null;
    }>(
      `SELECT event_id, endpoint_id, user_key, identity_source, geo_country
         FROM traffic.api_requests`,
    );
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.endpoint_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.user_key).not.toBeNull();
    }
    const geoIds = new Set<string>(batch.events.map((event) => event.eventId));
    const geoRows = rows.filter((row) => geoIds.has(row.event_id));
    expect(geoRows.map((row) => row.geo_country)).toEqual(['US', 'US']);
    const testNetRows = rows.filter((row) => !geoIds.has(row.event_id));
    for (const row of testNetRows) {
      if (row.geo_country !== null) expect(row.geo_country).toMatch(/^[A-Z]{2}$/);
    }
  });
});
