/**
 * Smoke of the dashboard through the `edge` gateway (see playwright.config.ts for how to run it).
 * Plan verification items 3/5/7: auth redirect, Overview, one detail page, a live tick after an
 * ingest, Apps as admin. Uses a dedicated app `smoke-test` (created once, reused afterwards).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ACCESS_TOKEN_COOKIE } from '@nexus/auth';
import {
  buildIngestUrl,
  buildPath,
  INGEST_HEADERS,
  ROUTES,
  type KeyCreatedDto,
} from '@nexus/shared';
import { expect, request, test, type APIRequestContext } from '@playwright/test';

import { signAccessToken } from '../../../scripts/mint-dev-token';

const BASE_URL = (process.env.SMOKE_BASE_URL ?? 'http://localhost:8080/traffic').replace(
  /\/+$/,
  '',
);
const ENV_FILE = path.join(__dirname, '..', '..', '..', '.env');
const SMOKE_APP = 'smoke-test';
const HTTP_CONFLICT = 409;

function readEnv(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`smoke needs the repo-root .env (${ENV_FILE})`);
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) env[match[1]!] = match[2]!.replace(/^"(.*)"$/, '$1');
  }
  return env;
}

const env = readEnv();
const ADMIN_EMAIL = (env.DASHBOARD_ADMIN_EMAILS ?? '').split(',')[0]!.trim();
const TOKEN = signAccessToken(ADMIN_EMAIL, env.LIBAS_JWT_SECRET ?? '');
const API = `${BASE_URL}/api`;

let api: APIRequestContext;
let secretKey: string;

/** Registers the smoke app if missing and issues a fresh secret key (admin API, CSRF header). */
async function prepareApp(): Promise<string> {
  const admin = { Cookie: `${ACCESS_TOKEN_COOKIE}=${TOKEN}`, [INGEST_HEADERS.dashboard]: '1' };
  const created = await api.post(`${API}${ROUTES.apps.create.path}`, {
    headers: admin,
    data: { slug: SMOKE_APP, displayName: 'Smoke test', basePath: `/${SMOKE_APP}` },
  });
  if (!created.ok() && created.status() !== HTTP_CONFLICT)
    throw new Error(`apps.create → ${created.status()}`);
  const key = await api.post(`${API}${buildPath(ROUTES.apps.createKey, { slug: SMOKE_APP })}`, {
    headers: admin,
    data: { kind: 'secret', label: 'playwright smoke' },
  });
  expect(key.status()).toBe(201);
  return ((await key.json()) as KeyCreatedDto).plaintextKey;
}

/** One server event for `routeTemplate` (202 expected). */
async function ingest(routeTemplate: string): Promise<void> {
  const now = new Date().toISOString();
  const res = await api.post(buildIngestUrl(BASE_URL, ROUTES.ingest.server), {
    headers: { [INGEST_HEADERS.key]: secretKey },
    data: {
      sentAt: now,
      sdk: { name: 'playwright-smoke', version: '1.0.0' },
      events: [
        {
          eventId: randomUUID(),
          occurredAt: now,
          method: 'GET',
          path: routeTemplate,
          routeTemplate,
          status: 200,
          durationMs: 12,
        },
      ],
    },
  });
  expect(res.status()).toBe(202);
}

test.beforeAll(async () => {
  expect(ADMIN_EMAIL, 'DASHBOARD_ADMIN_EMAILS in .env').toContain('@');
  api = await request.newContext();
  secretKey = await prepareApp();
  await ingest(`/${SMOKE_APP}/api/smoke/overview`);
});

test.afterAll(async () => {
  await api?.dispose();
});

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: ACCESS_TOKEN_COOKIE, value: TOKEN, domain: new URL(BASE_URL).hostname, path: '/' },
  ]);
});

test('without the SSO cookie the dashboard redirects to the portal login', async () => {
  const anonymous = await request.newContext();
  const res = await anonymous.get(`${BASE_URL}/`, { maxRedirects: 0 });
  expect([302, 303, 307]).toContain(res.status());
  expect(res.headers().location).toContain(encodeURIComponent('/traffic/'));
  await anonymous.dispose();
});

test('Overview loads its numbers', async ({ page }) => {
  await page.goto(`${BASE_URL}/`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(page.getByText('Could not load the headline numbers')).toHaveCount(0);
});

test('API Routes → endpoint detail page', async ({ page }) => {
  await page.goto(`${BASE_URL}/endpoints`);
  const link = page.getByRole('link', { name: `/${SMOKE_APP}/api/smoke/overview` }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/traffic\/endpoints\/[0-9a-f-]{36}/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('Live: an ingested call appears within seconds (socket via the gateway)', async ({ page }) => {
  await page.goto(`${BASE_URL}/live`);
  await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
  const route = `/${SMOKE_APP}/api/smoke/live-${randomUUID().slice(0, 8)}`;
  await ingest(route);
  await expect(page.getByText(route).first()).toBeVisible({ timeout: 8_000 });
});

test('Apps: an admin sees the registered app and the admin actions', async ({ page }) => {
  await page.goto(`${BASE_URL}/apps`);
  await expect(page.getByRole('heading', { level: 1, name: 'Apps' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register app' }).first()).toBeVisible();
  await expect(page.getByText(SMOKE_APP).first()).toBeVisible();
});
