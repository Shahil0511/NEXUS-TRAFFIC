/**
 * Generate `.env.example` — the template the Team Lead copies to `.env` on the server.
 *
 * WHY: the env keys are defined ONCE (apps/api/src/config/env.schema.ts); hand-maintaining a second
 * list in .env.example always drifts. This script renders every api key (in a fixed section order,
 * with a human description) plus the keys that only migrate, compose or the future web container
 * read. `--check` exits 1 when the committed file is stale, and
 * apps/api/test/env-example.test.ts asserts every key is claimed by someone.
 *
 * Usage (repo root):
 *   npm run env:example               → writes .env.example
 *   npm run env:example -- --check    → exit 1 if .env.example differs
 *
 * @see ../apps/api/src/config/env.schema.ts   the api keys (source of truth)
 * @see ../docker-compose.yml                   where compose/migrate keys are read
 */
import fs from 'node:fs';
import path from 'node:path';

import { apiEnvSchema } from '../apps/api/src/config/env.schema';

// ─── Key lists (the test imports these) ─────────────────────────────────────

/** Read ONLY by the `migrate` service (docker-compose.yml → environment). */
export const MIGRATE_KEYS = ['MIGRATION_DATABASE_URL', 'NEXUS_APP_DB_PASSWORD'] as const;

/** Read ONLY by docker compose itself / the postgres + pg-backup containers. */
export const COMPOSE_ONLY_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'PG_IMAGE',
] as const;

/** Read by the web container, which arrives in S2 (listed now so the TL fills .env once). */
export const WEB_KEYS = [
  'PORTAL_LOGIN_URL',
  'PORTAL_RETURN_PARAM',
  'NEXT_PUBLIC_SOCKET_PATH',
  'API_INTERNAL_URL',
] as const;

/**
 * Api keys the Docker image already sets correctly. They are rendered COMMENTED OUT because an
 * `env_file` value would override the image (e.g. NODE_ENV=development in production).
 */
export const IMAGE_MANAGED_KEYS = ['NODE_ENV', 'PORT', 'DOCS_DIR'] as const;

const WEB_NOTE = '(used by the web container from S2)';

/** Obviously-invalid placeholder; preflight.sh rejects anything that is not ≥ 64 hex chars. */
const SECRET_PLACEHOLDER = 'change-me-<openssl rand -hex 32>';

// ─── Sections and descriptions ──────────────────────────────────────────────

interface KeySpec {
  key: string;
  description: string;
  /** Placeholder written to the file; defaults to the schema default (or empty). */
  value?: string;
}

interface Section {
  title: string;
  keys: KeySpec[];
}

/** Every key, grouped. A key in apiEnvSchema without an entry here fails the script. */
export const SECTIONS: readonly Section[] = [
  {
    title: 'Postgres and migrations',
    keys: [
      {
        key: 'PG_IMAGE',
        description: 'Postgres image for postgres + pg-backup (compose only).',
        value: 'postgres:17-alpine',
      },
      {
        key: 'POSTGRES_USER',
        description: 'Database OWNER role, used by migrate and pg-backup (never by the api).',
        value: 'nexus_owner',
      },
      {
        key: 'POSTGRES_PASSWORD',
        description: 'Owner password. Hex only: openssl rand -hex 32.',
        value: SECRET_PLACEHOLDER,
      },
      { key: 'POSTGRES_DB', description: 'Database name.', value: 'nexus_traffic' },
      {
        key: 'MIGRATION_DATABASE_URL',
        description:
          'migrate connects as the owner. MUST repeat POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB.',
        value: 'postgres://nexus_owner:change-me-POSTGRES_PASSWORD@postgres:5432/nexus_traffic',
      },
      {
        key: 'NEXUS_APP_DB_PASSWORD',
        description:
          'Password migrate sets on the runtime role nexus_app on EVERY run (rotate = change + redeploy).',
        value: SECRET_PLACEHOLDER,
      },
      {
        key: 'DATABASE_URL',
        description:
          'The api connects as nexus_app (DML only). Password MUST equal NEXUS_APP_DB_PASSWORD.',
        value: 'postgres://nexus_app:change-me-NEXUS_APP_DB_PASSWORD@postgres:5432/nexus_traffic',
      },
      { key: 'PG_POOL_WRITE_MAX', description: 'api connections for ingest/admin writes.' },
      { key: 'PG_POOL_QUERY_MAX', description: 'api connections for dashboard reads.' },
    ],
  },
  {
    title: 'SSO (shared with the portal)',
    keys: [
      {
        key: 'LIBAS_JWT_SECRET',
        description:
          "The portal's JWT secret; verifies the access_token cookie. Runtime only, NEVER a build arg.",
        value: 'change-me-<the portal JWT_SECRET_KEY>',
      },
      {
        key: 'PORTAL_LOGIN_URL',
        description: `Where the dashboard sends signed-out users ${WEB_NOTE}.`,
        value: 'https://nexus.libas.in/login',
      },
      {
        key: 'PORTAL_RETURN_PARAM',
        description: `Query parameter carrying the return URL ${WEB_NOTE}.`,
        value: 'return',
      },
      {
        key: 'PUBLIC_ORIGIN',
        description: 'Public origin, used for absolute links (docs, redirects).',
      },
      {
        key: 'PUBLIC_BASE_PATH',
        description: 'Public URL prefix. Leave /traffic unless the gateway changes.',
      },
    ],
  },
  {
    title: 'Dashboard access',
    keys: [
      {
        key: 'DASHBOARD_ALLOWED_EMAILS',
        description:
          'Comma-separated allowlist. If set, ONLY these (+ admins) may open the dashboard.',
      },
      {
        key: 'DASHBOARD_ALLOWED_DOMAINS',
        description: 'Used only when DASHBOARD_ALLOWED_EMAILS is empty.',
      },
      {
        key: 'DASHBOARD_ADMIN_EMAILS',
        description: 'Admins manage apps/keys and see IP addresses. Put at least one email here.',
      },
    ],
  },
  {
    title: 'Secrets (hex only: openssl rand -hex 32)',
    keys: [
      {
        key: 'API_KEY_PEPPER',
        description: 'HMAC pepper for API key hashes. Changing it invalidates EVERY issued key.',
        value: SECRET_PLACEHOLDER,
      },
      {
        key: 'USER_KEY_SECRET',
        description: 'HMAC secret for opaque user ids in URLs. Changing it re-keys user links.',
        value: SECRET_PLACEHOLDER,
      },
      { key: 'IP_HASH_SECRET', description: 'HMAC secret for ip_hash.', value: SECRET_PLACEHOLDER },
    ],
  },
  {
    title: 'Privacy and retention',
    keys: [
      {
        key: 'IP_STORAGE_MODE',
        description: 'full | truncated | hashed. Geo is always resolved from the full IP first.',
      },
      {
        key: 'RAW_RETENTION_MONTHS',
        description: 'Months of raw events kept; older monthly partitions are dropped nightly.',
      },
    ],
  },
  {
    title: 'Network and ingest',
    keys: [
      {
        key: 'TRUST_PROXY_HOPS',
        description:
          'Proxies in front of the api (gateway nginx = 1). Never applies to the body `ip`.',
      },
      {
        key: 'CORS_DEV_ORIGINS',
        description: 'Extra browser origins allowed outside production (comma-separated).',
      },
      {
        key: 'INGEST_RATE_LIMIT_SERVER_PER_MIN',
        description: 'Server-ingest requests per key per minute.',
      },
      {
        key: 'INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN',
        description: 'Browser beacons per session per minute.',
      },
      {
        key: 'INGEST_IP_FAILURE_PER_MIN',
        description: 'Failed key authentications allowed per IP per minute.',
      },
    ],
  },
  {
    title: 'Docs and logging',
    keys: [
      {
        key: 'DOCS_CONTACT',
        description: 'Who other teams contact for keys (rendered into the public guide).',
      },
      { key: 'LOG_LEVEL', description: 'debug | info | warn | error.' },
    ],
  },
  {
    title: `Web ${WEB_NOTE}`,
    keys: [
      {
        key: 'NEXT_PUBLIC_SOCKET_PATH',
        description: 'Socket.io path the browser uses (build arg of the web image).',
        value: '/traffic/socket.io',
      },
      {
        key: 'API_INTERNAL_URL',
        description: 'Rewrite target for `next dev` only.',
        value: 'http://localhost:4000',
      },
    ],
  },
  {
    title: 'Set by the Docker image (keep commented when using Docker)',
    keys: [
      { key: 'NODE_ENV', description: 'production in the image; development when unset.' },
      {
        key: 'PORT',
        description: 'Port inside the container (compose maps 127.0.0.1:4005 → 4000).',
      },
      {
        key: 'DOCS_DIR',
        description:
          'Built docs directory; defaults to <repo>/docs/dist (/app/docs/dist in the image).',
        value: '/app/docs/dist',
      },
    ],
  },
];

// ─── Rendering ──────────────────────────────────────────────────────────────

const HEADER = [
  '# ─────────────────────────────────────────────────────────────────────────────',
  '# Data Nexus Traffic — environment template.',
  '# GENERATED by `npm run env:example` (scripts/generate-env-example.ts). Do not edit by hand.',
  '#',
  '# Server setup:  cp .env.example .env  → replace EVERY change-me value → bash scripts/preflight.sh',
  '# Secrets must be hex (openssl rand -hex 32) so they never need escaping inside URLs.',
  '# NEVER commit .env.',
  '# ─────────────────────────────────────────────────────────────────────────────',
];

type ShapeEntry = { safeParse: (value: unknown) => { success: boolean; data?: unknown } };

/** The api schema's keys with their default (undefined when required or optional-without-default). */
function apiDefaults(): Map<string, string | undefined> {
  const shape = apiEnvSchema.shape as unknown as Record<string, ShapeEntry>;
  return new Map(
    Object.entries(shape).map(([key, field]) => {
      const parsed = field.safeParse(undefined);
      return [key, parsed.success && parsed.data !== undefined ? String(parsed.data) : undefined];
    }),
  );
}

/** The api keys that have no default and are not optional — they MUST appear in .env. */
export function requiredApiKeys(): string[] {
  const shape = apiEnvSchema.shape as unknown as Record<string, ShapeEntry>;
  return Object.entries(shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

/** WHY: values with spaces are quoted so compose, dotenv and humans read them the same way. */
function formatValue(value: string): string {
  return /\s|#/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function renderKey(spec: KeySpec, defaults: Map<string, string | undefined>): string[] {
  const value = formatValue(spec.value ?? defaults.get(spec.key) ?? '');
  const commented = (IMAGE_MANAGED_KEYS as readonly string[]).includes(spec.key);
  return [`# ${spec.description}`, `${commented ? '# ' : ''}${spec.key}=${value}`];
}

function renderSection(section: Section, defaults: Map<string, string | undefined>): string[] {
  const banner = `# ─── ${section.title} `;
  return [
    '',
    banner.padEnd(79, '─'),
    ...section.keys.flatMap((spec, i) => [...(i > 0 ? [''] : []), ...renderKey(spec, defaults)]),
  ];
}

/** Fails loudly when the api schema gained a key nobody described. */
function assertEveryApiKeyDescribed(defaults: Map<string, string | undefined>): void {
  const described = new Set(SECTIONS.flatMap((s) => s.keys.map((k) => k.key)));
  const missing = [...defaults.keys()].filter((key) => !described.has(key));
  if (missing.length > 0) {
    throw new Error(
      `generate-env-example: add a description for ${missing.join(', ')} in SECTIONS`,
    );
  }
}

/** The full file content (pure). */
export function renderEnvExample(): string {
  const defaults = apiDefaults();
  assertEveryApiKeyDescribed(defaults);
  return `${[...HEADER, ...SECTIONS.flatMap((s) => renderSection(s, defaults))].join('\n')}\n`;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

export const ENV_EXAMPLE_PATH = path.resolve(__dirname, '..', '.env.example');

function main(argv: string[]): void {
  const content = renderEnvExample();
  if (argv.includes('--check')) {
    const current = fs.existsSync(ENV_EXAMPLE_PATH)
      ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8')
      : '';
    if (current !== content) {
      console.error('.env.example is stale — run `npm run env:example` and commit the result.');
      process.exit(1);
    }
    console.log('.env.example is current.');
    return;
  }
  fs.writeFileSync(ENV_EXAMPLE_PATH, content);
  console.log('wrote .env.example');
}

if (typeof require !== 'undefined' && require.main === module) main(process.argv.slice(2));
