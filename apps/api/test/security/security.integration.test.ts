/**
 * SECURITY SUITE (plan Phase 2) — part 2: against a fresh, migrated database as nexus_app, through
 * the real container + app over HTTP. The full case list (and where each one is proven) is in
 * security.test.ts next to this file.
 */
import { randomUUID } from 'node:crypto';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  buildPath,
  ERROR_CODES,
  INGEST_HEADERS,
  ROUTES,
  SERVER_BATCH_EXAMPLE,
  type IngestResultDto,
  type KeyCreatedDto,
  type KeyKind,
  type SessionDetailDto,
} from '@nexus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_MOUNT_PATH, createApp } from '../../src/app';
import { parseConfig } from '../../src/config';
import { createContainer, type Container } from '../../src/container';
import { caught, createTestDatabase, RUN_DB_TESTS, type TestDatabase } from '../db/test-database';
import { apiRequestRow } from '../db/fixtures';
import { signAccessToken } from '../fixtures/sign-access-token';
import { silentLogger } from '../ingest-fixtures';

const JWT_SECRET = 'security-db-jwt-secret-'.padEnd(48, 'x');
const ADMIN_EMAIL = 'admin@libas.in';
const ORIGIN = 'https://nexus.libas.in';
const APP_A = 'sec-alpha';
const APP_B = 'sec-beta';
/** The hop our gateway nginx appends (the only one TRUST_PROXY_HOPS=1 believes). */
const REAL_CLIENT_IP = '8.8.8.8';
const FORGED_IP = '6.6.6.6';
const CHECK_VIOLATION = '23514';

const url = (path: string) => `${API_MOUNT_PATH}${path}`;

function adminCookie(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${ACCESS_TOKEN_COOKIE}=${signAccessToken({ email: ADMIN_EMAIL, type: 'access', exp }, JWT_SECRET)}`;
}

describe.skipIf(!RUN_DB_TESTS)('security suite (db)', () => {
  let db: TestDatabase;
  let container: Container;
  let app: Express;
  const keys: Record<string, { secret: string; publishable: string }> = {};

  function admin(req: request.Test): request.Test {
    return req.set('Cookie', adminCookie()).set(INGEST_HEADERS.dashboard, '1');
  }

  async function createKey(slug: string, kind: KeyKind): Promise<KeyCreatedDto> {
    const res = await admin(
      request(app).post(url(buildPath(ROUTES.apps.createKey, { slug }))),
    ).send({ kind, label: kind });
    expect(res.status).toBe(201);
    return res.body as KeyCreatedDto;
  }

  async function registerApp(slug: string): Promise<void> {
    const res = await admin(request(app).post(url(ROUTES.apps.create.path))).send({
      slug,
      displayName: slug,
      basePath: `/${slug}`,
      allowedOrigins: [ORIGIN],
      browserIngestEnabled: true,
    });
    expect(res.status).toBe(201);
    keys[slug] = {
      secret: (await createKey(slug, 'secret')).plaintextKey,
      publishable: (await createKey(slug, 'publishable')).plaintextKey,
    };
  }

  function verify(key: string) {
    return request(app).get(url(ROUTES.ingest.verify.path)).set(INGEST_HEADERS.key, key);
  }

  /** One page_view beacon, sent like @nexus/react (text/plain, key in the body, page Origin). */
  function beacon(slug: string, sessionId: string, page: string, xff?: string) {
    const now = new Date();
    const body = {
      key: keys[slug]!.publishable,
      sentAt: now.toISOString(),
      sessionId,
      events: [
        {
          eventId: randomUUID(),
          type: 'page_view',
          occurredAt: now.toISOString(),
          seq: 0,
          path: `/${slug}/${page}`,
          nav: 'load',
        },
      ],
    };
    const req = request(app)
      .post(url(ROUTES.ingest.browser.path))
      .set('Content-Type', 'text/plain;charset=UTF-8')
      .set('Origin', ORIGIN);
    if (xff) req.set('X-Forwarded-For', xff);
    return req.send(JSON.stringify(body));
  }

  function serverEvent(overrides: Record<string, unknown>) {
    return {
      ...SERVER_BATCH_EXAMPLE.events[0],
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function sendServer(slug: string, events: unknown[]) {
    return request(app)
      .post(url(ROUTES.ingest.server.path))
      .set(INGEST_HEADERS.key, keys[slug]!.secret)
      .send({ sentAt: new Date().toISOString(), events });
  }

  beforeAll(async () => {
    db = await createTestDatabase('security');
    const config = parseConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: db.appUrl,
      LIBAS_JWT_SECRET: JWT_SECRET,
      DASHBOARD_ADMIN_EMAILS: ADMIN_EMAIL,
      TRUST_PROXY_HOPS: '1',
      API_KEY_PEPPER: 'a'.repeat(64),
      USER_KEY_SECRET: 'b'.repeat(64),
      IP_HASH_SECRET: 'c'.repeat(64),
    });
    container = createContainer(config, { logger: silentLogger() });
    app = createApp(container);
    await registerApp(APP_A);
    await registerApp(APP_B);
  });

  afterAll(async () => {
    if (container)
      await Promise.allSettled([container.pools.write.end(), container.pools.query.end()]);
    await db?.drop();
  });

  it('a revoked key is rejected on the very NEXT request (the key cache is invalidated)', async () => {
    const created = await createKey(APP_A, 'secret');
    expect((await verify(created.plaintextKey)).status).toBe(200); // now cached
    expect((await verify(created.plaintextKey)).status).toBe(200); // served from the cache

    const revoked = await admin(
      request(app).delete(
        url(buildPath(ROUTES.apps.revokeKey, { slug: APP_A, keyId: created.key.id })),
      ),
    );
    expect(revoked.status).toBe(200);

    const next = await verify(created.plaintextKey);
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe(ERROR_CODES.INVALID_API_KEY);
  });

  it('a forged leftmost X-Forwarded-For is ignored: the stored IP is the hop our gateway appended', async () => {
    const sessionId = randomUUID();
    const res = await beacon(APP_A, sessionId, 'xff', `${FORGED_IP}, ${REAL_CLIENT_IP}`);
    expect(res.status).toBe(202);
    const { rows } = await db.ownerPool.query<{ ip: string }>(
      'SELECT host(ip) AS ip FROM traffic.web_events WHERE session_id = $1',
      [sessionId],
    );
    expect(rows).toEqual([{ ip: REAL_CLIENT_IP }]);
  });

  it('the same session_id in two apps never mixes: each replay shows only its own app', async () => {
    const sessionId = randomUUID();
    expect((await beacon(APP_A, sessionId, 'alpha-page')).status).toBe(202);
    expect((await beacon(APP_B, sessionId, 'beta-page')).status).toBe(202);
    // An API call of app B claiming the same session must not be correlated into app A's replay.
    expect(
      (
        await sendServer(APP_B, [
          serverEvent({ sessionId, path: `/${APP_B}/api/x`, routeTemplate: `/${APP_B}/api/x` }),
        ])
      ).status,
    ).toBe(202);

    const replayOf = async (slug: string) => {
      const res = await admin(
        request(app)
          .get(url(buildPath(ROUTES.journeys.session, { app: slug, sessionId })))
          .query({ range: '24h' }),
      );
      expect(res.status).toBe(200);
      return (res.body as SessionDetailDto).events.map((e) => e.path);
    };
    expect(await replayOf(APP_A)).toEqual([`/${APP_A}/alpha-page`]);
    const beta = await replayOf(APP_B);
    expect(beta).toContain(`/${APP_B}/beta-page`);
    expect(beta.every((p) => p.startsWith(`/${APP_B}/`))).toBe(true);
  });

  it('a `javascript:` path is rejected per event over HTTP and nothing is stored', async () => {
    const before = await db.ownerPool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM traffic.api_requests',
    );
    const res = await sendServer(APP_A, [serverEvent({ path: 'javascript:alert(1)' })]);
    expect(res.status).toBe(202);
    const result = res.body as IngestResultDto;
    expect(result.accepted).toBe(0);
    expect(result.rejected.map((r) => r.index)).toEqual([0]);
    const after = await db.ownerPool.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM traffic.api_requests',
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('…and the database CHECK refuses it even if the api were bypassed (as nexus_app)', async () => {
    const { rows } = await db.ownerPool.query<{ id: string }>(
      'SELECT id FROM traffic.apps WHERE slug = $1',
      [APP_A],
    );
    const row = apiRequestRow(rows[0]!.id, { path: 'javascript:alert(1)' });
    const err = await caught(() => container.repositories.apiRequestIngest.insertBatch([row]));
    expect(err.code).toBe(CHECK_VIOLATION);
  });
});
