/**
 * "Seed demo data": registers app `demo-app` and gives it one secret + one publishable key.
 *
 * WHY: a fresh dev database has no apps, so the dashboard is empty and nothing can be ingested.
 * Seeding goes through the REAL admin API (the same routes the Apps page uses) so it exercises the
 * dev stack end to end. It is idempotent: an existing app is reused, and keys stored in `.env.dev`
 * are reused while the API still lists them as active.
 */
import {
  buildPath,
  createAppBodySchema,
  createKeyBodySchema,
  KEY_LOOKUP_PREFIX_LENGTH,
  ROUTES,
  type ApiKeyDto,
  type AppDto,
  type KeyCreatedDto,
  type KeyKind,
} from '@nexus/shared';

import type { DashboardApi } from './dashboard-api';
import { readDevEnvFile, updateDevEnvFile, type DemoKey } from './env-file';
import { log } from './log';

export const DEMO_APP = {
  slug: 'demo-app',
  displayName: 'Demo App',
  basePath: '/demo',
} as const;

const KEY_ENV_NAMES: Record<KeyKind, DemoKey> = {
  secret: 'DEMO_SECRET_KEY',
  publishable: 'DEMO_PUBLISHABLE_KEY',
};

export interface SeededKey {
  kind: KeyKind;
  /** The full key — returned to the launcher page only (copy button), NEVER logged. */
  value: string;
  prefix: string;
  created: boolean;
}

export interface SeedResult {
  appSlug: string;
  appCreated: boolean;
  keys: SeededKey[];
}

/** True when `stored` is still an active key of the app (not revoked, not expired). */
export function isStoredKeyActive(keys: readonly ApiKeyDto[], stored: string | undefined, kind: KeyKind, nowMs: number = Date.now()): boolean {
  if (!stored) return false;
  const prefix = stored.slice(0, KEY_LOOKUP_PREFIX_LENGTH);
  return keys.some(
    (key) =>
      key.kind === kind &&
      key.keyPrefix === prefix &&
      key.revokedAt === null &&
      (key.expiresAt === null || Date.parse(key.expiresAt) > nowMs),
  );
}

async function findDemoApp(api: DashboardApi): Promise<AppDto | null> {
  const apps = await api.call<AppDto[]>(ROUTES.apps.list);
  return apps.find((app) => app.slug === DEMO_APP.slug) ?? null;
}

async function createDemoApp(api: DashboardApi, launcherOrigin: string): Promise<AppDto> {
  const body = createAppBodySchema.parse({ ...DEMO_APP, allowedOrigins: [launcherOrigin] });
  return api.call<AppDto>(ROUTES.apps.create, ROUTES.apps.create.path, body);
}

/** The launcher port can change between runs; keep its origin on the app's browser allowlist. */
async function ensureAllowedOrigin(api: DashboardApi, app: AppDto, launcherOrigin: string): Promise<void> {
  if (app.allowedOrigins.includes(launcherOrigin)) return;
  const path = buildPath(ROUTES.apps.update, { slug: app.slug });
  await api.call<AppDto>(ROUTES.apps.update, path, { allowedOrigins: [...app.allowedOrigins, launcherOrigin] });
}

async function createKey(api: DashboardApi, kind: KeyKind): Promise<string> {
  const path = buildPath(ROUTES.apps.createKey, { slug: DEMO_APP.slug });
  const body = createKeyBodySchema.parse({ kind, label: `dev launcher (${kind})` });
  const created = await api.call<KeyCreatedDto>(ROUTES.apps.createKey, path, body);
  return created.plaintextKey;
}

/** Creates what is missing and stores the keys in `.env.dev`. */
export async function seedDemoApp(api: DashboardApi, envFile: string, launcherOrigin: string): Promise<SeedResult> {
  let app = await findDemoApp(api);
  const appCreated = app === null;
  if (app === null) {
    app = await createDemoApp(api, launcherOrigin);
    log('launcher', `created app "${DEMO_APP.slug}"`);
  } else {
    await ensureAllowedOrigin(api, app, launcherOrigin);
  }

  const stored: Partial<Record<DemoKey, string>> = readDevEnvFile(envFile) ?? {};
  const keys: SeededKey[] = [];
  for (const kind of ['secret', 'publishable'] as const) {
    const envName = KEY_ENV_NAMES[kind];
    const existing = stored[envName];
    const reuse = existing !== undefined && isStoredKeyActive(app.keys, existing, kind);
    const value = reuse ? existing : await createKey(api, kind);
    keys.push({ kind, value, prefix: value.slice(0, KEY_LOOKUP_PREFIX_LENGTH), created: !reuse });
  }
  updateDevEnvFile(envFile, Object.fromEntries(keys.map((k) => [KEY_ENV_NAMES[k.kind], k.value])));
  for (const key of keys) {
    log('launcher', `${key.created ? 'created' : 'reusing'} ${key.kind} key ${key.prefix}… (stored in .env.dev)`);
  }
  return { appSlug: DEMO_APP.slug, appCreated, keys };
}
