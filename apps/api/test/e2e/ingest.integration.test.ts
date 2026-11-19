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
  INGEST_CONTRACT_VERSION,
  INGEST_HEADERS,
  ROUTES,
  SDK_DEFAULTS,
  sdkRemoteConfigSchema,
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

function testConfig(databaseUrl: string, extra: Record<string, string> = {}) {
  return parseConfig({
    ...extra,
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

  it('an invalid envelope with a 300-char X-Nexus-SDK is recorded as one reason row with sdk ""', async () => {
    const res = await request(app)
      .post(url(ROUTES.ingest.server.path))
      .set(INGEST_HEADERS.key, secretKey)
      .set(INGEST_HEADERS.sdk, 'x'.repeat(300))
      .send({ events: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.INVALID_ENVELOPE);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { rows } = await db.ownerPool.query(
      `SELECT source, sdk, code, schema_path, rejected FROM traffic.ingest_rejections WHERE code = 'INVALID_ENVELOPE'`,
    );
    expect(rows).toEqual([{ source: 'server', sdk: '', code: 'INVALID_ENVELOPE', schema_path: '', rejected: 1 }]);
  });

  it('per-event rejects are recorded by code + schema path; the stored environment is the claim', async () => {
    const batch = freshBatch();
    const res = await sendServer(
      { ...batch, environment: 'staging', events: [...batch.events, { ...batch.events[0], eventId: randomUUID(), status: 7 }] },
      secretKey,
    );
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ accepted: 2, rejected: [{ index: 2, code: ERROR_CODES.INVALID_EVENT }] });
    const reasons = await db.ownerPool.query(
      `SELECT sdk, code, schema_path FROM traffic.ingest_rejections WHERE code = 'INVALID_EVENT'`,
    );
    expect(reasons.rows).toEqual([{ sdk: '@nexus/express@1.1.0', code: 'INVALID_EVENT', schema_path: 'status' }]);
    const stored = await db.ownerPool.query(
      `SELECT DISTINCT environment FROM traffic.api_requests WHERE event_id = ANY($1::uuid[])`,
      [batch.events.map((e) => e.eventId)],
    );
    expect(stored.rows).toEqual([{ environment: 'staging' }]);
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
      expect(row).toMatchObject({ identity_source: 'anonymous', user_email: null, sdk: '@nexus/react@1.1.0' });
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

// ─── Phase A: SDK config, pre-auth CORS, IP limiter rule, diagnostics ───────

describe.skipIf(!RUN_DB_TESTS)('Phase A e2e: config, pre-auth CORS and ingest diagnostics (db)', () => {
  const REGISTERED = 'https://pos.libas.in';
  const LOCALHOST = 'http://localhost:3000';
  const UNREGISTERED = 'https://evil.example';
  const KILLED_SLUG = 'pos-killed';
  const LIVE_SLUG = 'pos-live';
  /**
   * Small budgets so the limiter cases are cheap. The pre-auth CORS case spends 2 real key-guess
   * failures (401 INVALID_API_KEY) of this IP's budget and the reject-reasons case 1 counted
   * ORIGIN_NOT_ALLOWED; everything after them must still pass (the flood case runs last).
   */
  const IP_FAILURES = 4;
  /** Per key per minute — shared by the ingest and the (separate) config limiter instances. */
  const CONFIG_PER_MIN = 5;

  let db: TestDatabase;
  let container: Container;
  let app: Express;
  let killedKey: string;
  let liveKey: string;
  let liveAppId: string;

  function admin(req: request.Test): request.Test {
    return req.set('Cookie', adminCookie()).set(INGEST_HEADERS.dashboard, '1');
  }

  async function registerApp(slug: string, allowedOrigins: string[] = [REGISTERED, LOCALHOST]): Promise<AppDto> {
    const res = await admin(request(app).post(url(ROUTES.apps.create.path))).send({
      slug,
      displayName: slug,
      basePath: '/ebo-audit',
      allowedOrigins,
      browserIngestEnabled: true,
    });
    expect(res.status).toBe(201);
    return res.body as AppDto;
  }

  async function createKey(slug: string): Promise<string> {
    const res = await admin(request(app).post(url(buildPath(ROUTES.apps.createKey, { slug })))).send({
      kind: 'publishable',
      label: 'e2e phase a',
    });
    expect(res.status).toBe(201);
    return (res.body as KeyCreatedDto).plaintextKey;
  }

  function postText(path: string, body: unknown, origin: string | null = REGISTERED) {
    const req = request(app).post(url(path)).set('Content-Type', 'text/plain;charset=UTF-8');
    if (origin) req.set('Origin', origin);
    return req.send(typeof body === 'string' ? body : JSON.stringify(body));
  }

  const beacon = (body: unknown, origin: string | null = REGISTERED) =>
    postText(ROUTES.ingest.browser.path, body, origin);
  const configPoll = (body: unknown, origin: string | null = REGISTERED) =>
    postText(ROUTES.ingest.config.path, body, origin);

  beforeAll(async () => {
    db = await createTestDatabase('e2e_phase_a');
    container = createContainer(
      testConfig(db.appUrl, {
        INGEST_IP_FAILURE_PER_MIN: String(IP_FAILURES),
        INGEST_RATE_LIMIT_BROWSER_PER_MIN: String(CONFIG_PER_MIN),
        INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN: '1000',
      }),
      { logger: silentLogger() },
    );
    app = createApp(container);
    await registerApp(KILLED_SLUG);
    const live = await registerApp(LIVE_SLUG);
    killedKey = await createKey(KILLED_SLUG);
    liveKey = await createKey(LIVE_SLUG);
    const { rows } = await db.ownerPool.query<{ id: string }>('SELECT id FROM traffic.apps WHERE slug = $1', [
      live.slug,
    ]);
    liveAppId = rows[0]!.id;
  });

  afterAll(async () => {
    if (container)
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    await db?.drop();
  });

  // ─── POST ROUTES.ingest.config ─────────────────────────────────────────────

  it('config: 200 SdkRemoteConfig (version + modules), no-store, readable by the registered origin', async () => {
    const res = await configPoll({ key: liveKey, client: { sdk: '@nexus/react', version: '1.1.0' } });
    expect(res.status).toBe(200);
    expect(sdkRemoteConfigSchema.parse(res.body)).toEqual({
      contract: INGEST_CONTRACT_VERSION,
      version: 1,
      enabled: true,
      disabledModules: [],
      maxAgeMs: SDK_DEFAULTS.browser.configMaxAgeMs,
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['access-control-allow-origin']).toBe(REGISTERED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('config is a CORS simple request: text/plain, no preflight needed, the key only in the body', async () => {
    // A browser sends no OPTIONS for a text/plain POST; the poll succeeds without one.
    const res = await configPoll({ key: liveKey });
    expect(res.status).toBe(200);
    expect(ROUTES.ingest.config.path).not.toContain(':');
  });

  it('pre-auth errors carry ACAO + ACAC for a registered origin, none for an unregistered one', async () => {
    const cases: Array<[() => request.Test, () => request.Test, number, string]> = [
      [
        () => configPoll({ key: 'nx_pk_00000000_doesnotexist000000000000' }),
        () => configPoll({ key: 'nx_pk_00000000_doesnotexist000000000000' }, UNREGISTERED),
        401,
        ERROR_CODES.INVALID_API_KEY,
      ],
      [() => configPoll('{"key":'), () => configPoll('{"key":', UNREGISTERED), 400, ERROR_CODES.INVALID_ENVELOPE],
      [
        () => beacon({ not: 'an envelope' }),
        () => beacon({ not: 'an envelope' }, UNREGISTERED),
        400,
        ERROR_CODES.INVALID_ENVELOPE,
      ],
    ];
    for (const [registered, unregistered, status, code] of cases) {
      const ok = await registered();
      expect(ok.status).toBe(status);
      expect(ok.body.error.code).toBe(code);
      expect(ok.headers['access-control-allow-origin']).toBe(REGISTERED);
      expect(ok.headers['access-control-allow-credentials']).toBe('true');
      const foreign = await unregistered();
      expect(foreign.status).toBe(status);
      expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
      expect(foreign.headers['access-control-allow-credentials']).toBeUndefined();
    }
  });

  it('kill switch: config and beacons answer 403 BROWSER_INGEST_DISABLED, readable cross-origin', async () => {
    const patched = await admin(request(app).patch(url(buildPath(ROUTES.apps.update, { slug: KILLED_SLUG })))).send({
      browserIngestEnabled: false,
    });
    expect(patched.status).toBe(200);
    const config = await configPoll({ key: killedKey });
    expect(config.status).toBe(403);
    expect(config.body.error.code).toBe(ERROR_CODES.BROWSER_INGEST_DISABLED);
    expect(config.headers['access-control-allow-origin']).toBe(REGISTERED);
    const killed = await beacon(freshBrowserBatch(killedKey));
    expect(killed.status).toBe(403);
    expect(killed.body.error.code).toBe(ERROR_CODES.BROWSER_INGEST_DISABLED);
    expect(killed.headers['access-control-allow-origin']).toBe(REGISTERED);
    const foreign = await configPoll({ key: killedKey }, UNREGISTERED);
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('a killed / disabled app whose origin NO other app lists still gets a READABLE 403', async () => {
    const SOLO = 'https://solo.libas.in';
    const SOLO_SLUG = 'pos-solo';
    await registerApp(SOLO_SLUG, [SOLO]);
    const soloKey = await createKey(SOLO_SLUG);
    const patchSolo = (body: Record<string, boolean>) =>
      admin(request(app).patch(url(buildPath(ROUTES.apps.update, { slug: SOLO_SLUG })))).send(body);

    expect((await patchSolo({ browserIngestEnabled: false })).status).toBe(200);
    for (const res of [await configPoll({ key: soloKey }, SOLO), await beacon(freshBrowserBatch(soloKey), SOLO)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(ERROR_CODES.BROWSER_INGEST_DISABLED);
      expect(res.headers['access-control-allow-origin']).toBe(SOLO);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }

    expect((await patchSolo({ browserIngestEnabled: true, isActive: false })).status).toBe(200);
    const disabled = await configPoll({ key: soloKey }, SOLO);
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe(ERROR_CODES.APP_DISABLED);
    expect(disabled.headers['access-control-allow-origin']).toBe(SOLO);
  });

  it(`${IP_FAILURES * 3} kill-switch 403s from one IP never 429 another app's valid beacon (ADR 0009)`, async () => {
    for (let i = 0; i < IP_FAILURES * 3; i += 1) {
      expect((await beacon(freshBrowserBatch(killedKey))).status).toBe(403);
    }
    const ok = await beacon(freshBrowserBatch(liveKey));
    expect(ok.status).toBe(202);
    expect(ok.body).toMatchObject({ accepted: 3 });
  });

  it('config polls use their own limiter and never touch ingest_counters.rate_limited', async () => {
    const before = await db.ownerPool.query<{ n: number }>(
      'SELECT coalesce(sum(rate_limited), 0)::int AS n FROM traffic.ingest_counters',
    );
    const statuses: number[] = [];
    for (let i = 0; i < CONFIG_PER_MIN + 2; i += 1) statuses.push((await configPoll({ key: liveKey })).status);
    expect(statuses).toContain(429);
    // The ingest budget of the same key is untouched by the polls.
    expect((await beacon(freshBrowserBatch(liveKey))).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const after = await db.ownerPool.query<{ n: number }>(
      'SELECT coalesce(sum(rate_limited), 0)::int AS n FROM traffic.ingest_counters',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  // ─── Stored diagnostics ────────────────────────────────────────────────────

  it('a localhost page origin is stored as dev; envelope release / tz / lang are stored', async () => {
    const batch = freshBrowserBatch(liveKey, { environment: 'prod' });
    const res = await beacon(batch, LOCALHOST);
    expect(res.status).toBe(202);
    const { rows } = await db.ownerPool.query(
      `SELECT DISTINCT environment, release, client_tz, client_lang FROM traffic.web_events WHERE session_id = $1`,
      [batch.sessionId],
    );
    expect(rows).toEqual([
      { environment: 'dev', release: '2026.11.18-a1b2c3d', client_tz: 'Asia/Kolkata', client_lang: 'en-IN' },
    ]);
  });

  it('reject reasons are persisted as codes without any message text', async () => {
    await beacon(freshBrowserBatch(liveKey), UNREGISTERED); // ORIGIN_NOT_ALLOWED (app known)
    await new Promise((resolve) => setTimeout(resolve, 100));
    const { rows } = await db.ownerPool.query(
      `SELECT source, sdk, code, schema_path, rejected FROM traffic.ingest_rejections WHERE app_id = $1`,
      [liveAppId],
    );
    expect(rows).toContainEqual({
      source: 'browser',
      sdk: '',
      code: ERROR_CODES.ORIGIN_NOT_ALLOWED,
      schema_path: '',
      rejected: expect.any(Number),
    });
    const text = JSON.stringify(rows);
    expect(text).not.toMatch(/origin is not allowed|expected|Invalid/i);
  });

  it('a replay never uses the SSO cookie and records no SSO outcome', async () => {
    const before = await db.ownerPool.query<{ n: number }>(
      'SELECT coalesce(sum(beacons), 0)::int AS n FROM traffic.sso_cookie_outcomes WHERE app_id = $1',
      [liveAppId],
    );
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const cookie = `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email: ADMIN_EMAIL, type: 'access', exp }, JWT_SECRET)}`;
    const replay = freshBrowserBatch(liveKey, {
      client: { sdk: '@nexus/react', version: '1.1.0', replay: true },
    });
    const res = await beacon(replay).set('Cookie', cookie);
    expect(res.status).toBe(202);
    const { rows } = await db.ownerPool.query(
      `SELECT DISTINCT identity_source, user_email FROM traffic.web_events WHERE session_id = $1`,
      [replay.sessionId],
    );
    expect(rows).toEqual([{ identity_source: 'anonymous', user_email: null }]);
    const after = await db.ownerPool.query<{ n: number }>(
      'SELECT coalesce(sum(beacons), 0)::int AS n FROM traffic.sso_cookie_outcomes WHERE app_id = $1',
      [liveAppId],
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  // LAST: it spends this IP's whole failure budget.
  it('an ORIGIN_NOT_ALLOWED flood (public key, forged Origin) from one IP is cut off with 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < IP_FAILURES + 2; i += 1) {
      statuses.push((await beacon(freshBrowserBatch(liveKey), UNREGISTERED)).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(IP_FAILURES);
  });
});
