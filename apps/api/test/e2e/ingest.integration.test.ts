/**
 * S1 + S3 end to end, in process: the REAL container (createContainer) and app (createApp) against a
 * fresh, migrated database, connected as nexus_app exactly like production.
 *
 * WHY: unit tests prove each piece; this proves the wiring. An admin creates an app and keys through
 * the dashboard routes (SSO cookie + X-Nexus-Dashboard), then the public ingest contract is driven
 * over HTTP the way other teams' middleware will call it: accept, dedupe on resend, dry run, the
 * key error branches, verify, health, and the stored row shape (endpoint_id, user_key, geo).
 * S3 drives the browser beacon the way @nexus/react sends it (text/plain, key in the body, Origin):
 * CORS, origin guard, base-path rule, SSO-cookie vs claimed identity, SECRET_KEY_EXPOSED (+ exposed_at),
 * BROWSER_INGEST_DISABLED and APP_DISABLED.
 */
import { randomUUID } from 'node:crypto';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  BROWSER_BATCH_EXAMPLE,
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

// ─── S3: browser ingest ─────────────────────────────────────────────────────

const BROWSER_APP_SLUG = 'ebo-audit';
const BROWSER_ORIGIN = 'https://audit.libas.in';
const SSO_USER_EMAIL = 'saurabh@libas.in';

/** BROWSER_BATCH_EXAMPLE with a real key, fresh ids and timestamps inside the accepted window. */
function freshBrowserBatch(key: string, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  const pageViewId = randomUUID();
  const ids = [pageViewId, randomUUID(), randomUUID()];
  return {
    ...BROWSER_BATCH_EXAMPLE,
    key,
    sentAt: new Date(now).toISOString(),
    sessionId: randomUUID(),
    events: BROWSER_BATCH_EXAMPLE.events.map((event, i) => ({
      ...event,
      eventId: ids[i],
      occurredAt: new Date(now - 1000 + i).toISOString(),
      ...(event.type === 'page_time' ? { pageViewId } : {}),
    })),
    ...extra,
  };
}

describe.skipIf(!RUN_DB_TESTS)('S3 e2e: browser ingest over HTTP (db)', () => {
  let db: TestDatabase;
  let container: Container;
  let app: Express;
  let publishableKey: string;
  let secretKey: string;

  function admin(req: request.Test): request.Test {
    return req.set('Cookie', adminCookie()).set(INGEST_HEADERS.dashboard, '1');
  }

  async function registerApp(slug: string, extra: Record<string, unknown> = {}): Promise<void> {
    const res = await admin(request(app).post(url(ROUTES.apps.create.path))).send({
      slug,
      displayName: slug,
      basePath: `/${slug}`,
      allowedOrigins: [BROWSER_ORIGIN],
      browserIngestEnabled: true,
      ...extra,
    });
    expect(res.status).toBe(201);
  }

  async function createKey(slug: string, kind: KeyKind): Promise<string> {
    const res = await admin(request(app).post(url(buildPath(ROUTES.apps.createKey, { slug })))).send({
      kind,
      label: `e2e ${kind}`,
    });
    expect(res.status).toBe(201);
    return (res.body as KeyCreatedDto).plaintextKey;
  }

  async function patchApp(slug: string, body: Record<string, unknown>): Promise<void> {
    const res = await admin(request(app).patch(url(buildPath(ROUTES.apps.update, { slug })))).send(body);
    expect(res.status).toBe(200);
  }

  /** What @nexus/react sends: sendBeacon → text/plain, key in the body, page Origin. */
  function beacon(body: unknown, origin: string | null = BROWSER_ORIGIN) {
    const req = request(app)
      .post(url(ROUTES.ingest.browser.path))
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
    if (origin) req.set('Origin', origin);
    return req.send(JSON.stringify(body));
  }

  beforeAll(async () => {
    db = await createTestDatabase('e2e_browser_ingest');
    container = createContainer(testConfig(db.appUrl), { logger: silentLogger() });
    app = createApp(container);
    await registerApp(BROWSER_APP_SLUG);
    publishableKey = await createKey(BROWSER_APP_SLUG, 'publishable');
    secretKey = await createKey(BROWSER_APP_SLUG, 'secret');
  });

  afterAll(async () => {
    if (container)
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    await db?.drop();
  });

  it('accepts a text/plain beacon (202 + CORS for the allowed origin), then dedupes the resend', async () => {
    const batch = freshBrowserBatch(publishableKey);
    const first = await beacon(batch);
    expect(first.status).toBe(202);
    expect(first.body as IngestResultDto).toMatchObject({ accepted: 3, duplicates: 0, rejected: [] });
    expect(first.headers['access-control-allow-origin']).toBe(BROWSER_ORIGIN);
    expect(first.headers['access-control-allow-credentials']).toBe('true');

    const resend = await beacon({ ...batch, sentAt: new Date().toISOString() });
    expect(resend.body).toMatchObject({ accepted: 0, duplicates: 3 });
  });

  it('stores the rows: event types, anonymous identity, UA and the page_time fields', async () => {
    const batch = freshBrowserBatch(publishableKey);
    expect((await beacon(batch)).body).toMatchObject({ accepted: 3 });
    const { rows } = await db.ownerPool.query<{
      event_type: string;
      identity_source: string;
      user_email: string | null;
      ua_browser: string | null;
      visible_ms: number | null;
      sdk: string | null;
    }>(
      `SELECT event_type, identity_source, user_email, ua_browser, visible_ms, sdk
         FROM traffic.web_events WHERE session_id = $1 ORDER BY seq`,
      [batch.sessionId],
    );
    expect(rows.map((r) => r.event_type)).toEqual(['page_view', 'tool_use', 'page_time']);
    expect(rows[2]?.visible_ms).toBe(57400);
    for (const row of rows) {
      expect(row).toMatchObject({ identity_source: 'anonymous', user_email: null, sdk: '@nexus/react@1.0.0' });
      expect(row.ua_browser).toMatch(/Chrome/);
    }
  });

  it('a valid SSO cookie → sso_cookie with user_email + user_key; a hint alone → client_claimed', async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email: SSO_USER_EMAIL, type: 'access', exp }, JWT_SECRET)}`;
    const verified = freshBrowserBatch(publishableKey, { user: { email: 'forged@libas.in' } });
    expect((await beacon(verified).set('Cookie', cookie)).body).toMatchObject({ accepted: 3 });
    const claimed = freshBrowserBatch(publishableKey, { user: { email: 'hint@libas.in' } });
    expect((await beacon(claimed)).body).toMatchObject({ accepted: 3 });

    const { rows } = await db.ownerPool.query<{
      session_id: string;
      identity_source: string;
      user_email: string | null;
      user_key: Buffer | null;
      claimed_email: string | null;
    }>(
      `SELECT DISTINCT session_id::text, identity_source, user_email, user_key, claimed_email
         FROM traffic.web_events WHERE session_id = ANY($1::uuid[])`,
      [[verified.sessionId, claimed.sessionId]],
    );
    const bySession = new Map(rows.map((row) => [row.session_id, row]));
    expect(bySession.get(verified.sessionId)).toMatchObject({
      identity_source: 'sso_cookie',
      user_email: SSO_USER_EMAIL,
      claimed_email: null,
    });
    expect(bySession.get(verified.sessionId)?.user_key).toHaveLength(32);
    expect(bySession.get(claimed.sessionId)).toMatchObject({
      identity_source: 'client_claimed',
      user_email: null,
      user_key: null,
      claimed_email: 'hint@libas.in',
    });
  });

  it('a path outside the base path is rejected per event (PATH_OUTSIDE_APP)', async () => {
    const batch = freshBrowserBatch(publishableKey);
    batch.events[1] = { ...batch.events[1]!, path: '/ebo-sales/audits' };
    const res = await beacon(batch);
    expect(res.status).toBe(202);
    expect(res.body.rejected).toEqual([{ index: 1, code: ERROR_CODES.PATH_OUTSIDE_APP, message: expect.any(String) }]);
  });

  it('a foreign Origin, Origin: null and a missing Origin/Referer → 403 ORIGIN_NOT_ALLOWED', async () => {
    for (const origin of ['https://evil.example', 'null', null]) {
      const res = await beacon(freshBrowserBatch(publishableKey), origin);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ERROR_CODES.ORIGIN_NOT_ALLOWED);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('OPTIONS preflight reflects only a registered origin', async () => {
    const ok = await request(app).options(url(ROUTES.ingest.browser.path)).set('Origin', BROWSER_ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(BROWSER_ORIGIN);
    const foreign = await request(app).options(url(ROUTES.ingest.browser.path)).set('Origin', 'https://evil.example');
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a secret key on the browser endpoint → 403 SECRET_KEY_EXPOSED and api_keys.exposed_at is set', async () => {
    const res = await beacon(freshBrowserBatch(secretKey));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(ERROR_CODES.SECRET_KEY_EXPOSED);
    const { rows } = await db.ownerPool.query<{ exposed: number }>(
      `SELECT count(*)::int AS exposed FROM traffic.api_keys WHERE kind = 'secret' AND exposed_at IS NOT NULL`,
    );
    expect(rows[0]?.exposed).toBe(1);
  });

  it('GET ingest/verify accepts the publishable key too', async () => {
    const res = await request(app).get(url(ROUTES.ingest.verify.path)).set(INGEST_HEADERS.key, publishableKey);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ app: { slug: BROWSER_APP_SLUG }, keyKind: 'publishable' });
  });

  it('a malformed beacon → 400 INVALID_ENVELOPE; a form post → 415', async () => {
    const bad = await request(app)
      .post(url(ROUTES.ingest.browser.path))
      .set('Content-Type', 'text/plain')
      .set('Origin', BROWSER_ORIGIN)
      .send('{"key":');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
    const form = await request(app)
      .post(url(ROUTES.ingest.browser.path))
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1');
    expect(form.status).toBe(415);
  });

  it('browser ingest disabled → 403 BROWSER_INGEST_DISABLED; app disabled → 403 APP_DISABLED', async () => {
    await patchApp(BROWSER_APP_SLUG, { browserIngestEnabled: false });
    const off = await beacon(freshBrowserBatch(publishableKey));
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe(ERROR_CODES.BROWSER_INGEST_DISABLED);

    await patchApp(BROWSER_APP_SLUG, { browserIngestEnabled: true, isActive: false });
    const disabled = await beacon(freshBrowserBatch(publishableKey));
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe(ERROR_CODES.APP_DISABLED);
  });

  it('counted the accepted beacons under source browser', async () => {
    const { rows } = await db.ownerPool.query<{ accepted: number }>(
      `SELECT sum(accepted)::int AS accepted FROM traffic.ingest_counters WHERE source = 'browser'`,
    );
    expect(rows[0]?.accepted).toBeGreaterThanOrEqual(12);
  });
});
