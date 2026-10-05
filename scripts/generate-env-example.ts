/**
 * Generate `.env.example` — the template the Team Lead copies to `.env` on the server.
 *
 * WHY: the env keys are defined ONCE (apps/api/src/config/env.schema.ts); hand-maintaining a second
 * list in .env.example always drifts. This script renders every api key (in a fixed section order,
 * with a human description) plus the keys that only migrate, compose or the web container
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

/** Read ONLY by the `migrate` service (docker-compose.yml → environment, apps/api/src/db/migrate-config.ts). */
export const MIGRATE_KEYS = ['MIGRATION_DATABASE_URL', 'DB_APP_ROLE_MODE', 'NEXUS_APP_DB_PASSWORD'] as const;

/** Read ONLY by docker compose itself / the postgres (profile localdb) + pg-backup containers. */
export const COMPOSE_ONLY_KEYS = [
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'PG_IMAGE',
  'BACKUP_DATABASE_URL',
  'BACKUP_AT_IST',
  'BACKUP_KEEP',
  'NEXUS_PORT',
  'NEXUS_BIND_ADDRESS',
] as const;

/** Read ONLY by the web container (apps/web/src/env.schema.ts + its test). */
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

/**
 * Shape of a connection string to the external server — PLACEHOLDERS ONLY. Real logins and
 * passwords live ONLY in the git-ignored .env on the deploy host (ADR 0002).
 */
const EXTERNAL_URL_PLACEHOLDER =
  'postgres://change-me-login:change-me-url-encoded-password@change-me-host:5432/change-me-database';

const LOCALDB_NOTE = 'ONLY for --profile localdb';

// ─── Sections and descriptions ──────────────────────────────────────────────

interface KeySpec {
  key: string;
  /** One or more lines (split on \n); each becomes a `# …` comment above the key. */
  description: string;
  /** Placeholder written to the file; defaults to the schema default (or empty). */
  value?: string;
}

interface Section {
  title: string;
  /** Comment lines printed under the section banner. */
  notes?: string[];
  keys: KeySpec[];
}

/** Every key, grouped. A key in apiEnvSchema without an entry here fails the script. */
export const SECTIONS: readonly Section[] = [
  {
    title: 'Hosting — the ONE host port (ADR 0004)',
    notes: [
      'Only the `edge` nginx container is published; api and web stay on the internal Docker network.',
      'The nexus.libas.in gateway forwards /traffic/… to http://<this host>:NEXUS_PORT with the path',
      'kept (ops/nginx/nexus-traffic.conf). Changing either value needs `docker compose up -d`.',
    ],
    keys: [
      {
        key: 'NEXUS_PORT',
        description: 'Host port of the edge nginx — the port the Team Lead assigns to Nexus Traffic.',
        value: '8080',
      },
      {
        key: 'NEXUS_BIND_ADDRESS',
        description: [
          'Host interface for NEXUS_PORT. 0.0.0.0 = reachable from the gateway on another machine;',
          '127.0.0.1 = only when the gateway nginx runs on THIS host (safer: nobody can bypass it).',
        ].join('\n'),
        value: '0.0.0.0',
      },
    ],
  },
  {
    title: 'Database (ADR 0002)',
    notes: [
      'Production: the EXTERNAL company Postgres server 10.150.0.5 (PostgreSQL 18), database',
      'nexus_traffic, schema traffic — no postgres container (plain `docker compose up -d --build`).',
      'Local laptop / CI: `docker compose --profile localdb up -d --build` and the',
      'localdb values shown in each description below.',
      'Connection strings: postgres://<login>:<password>@<host>:<port>/<database>',
      'URL-ENCODE the password inside a URL: @ → %40, : → %3A, / → %2F, # → %23, % → %25',
      '(a raw @ in the password makes the host part wrong). Docker Compose also expands $ in .env',
      'values: write a literal $ as $$.',
      'NEVER commit real logins/passwords: they belong ONLY in the git-ignored .env on the host.',
    ],
    keys: [
      {
        key: 'DB_APP_ROLE_MODE',
        description: [
          'How the api connects (read by migrate). One of:',
          '  owner    → production on the shared server, whose login cannot create roles: migrate creates',
          '             NO role; the api uses the SAME login, so DATABASE_URL = MIGRATION_DATABASE_URL.',
          '  separate → --profile localdb: migrate creates role nexus_app (DML only, grants re-applied on',
          '             every run) with NEXUS_APP_DB_PASSWORD; the api connects as nexus_app.',
          'Compose defaults to separate when this is empty.',
        ].join('\n'),
        value: 'owner',
      },
      {
        key: 'MIGRATION_DATABASE_URL',
        description: [
          'migrate connects with this OWNER login (it runs the DDL).',
          '  owner mode (production): the shared login, e.g. …@10.150.0.5:5432/nexus_traffic',
          '  localdb: postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>',
        ].join('\n'),
        value: EXTERNAL_URL_PLACEHOLDER,
      },
      {
        key: 'DATABASE_URL',
        description: [
          'The api connects with this login.',
          '  owner mode: MUST be IDENTICAL to MIGRATION_DATABASE_URL (preflight.sh checks it).',
          '  separate mode: postgres://nexus_app:<NEXUS_APP_DB_PASSWORD>@postgres:5432/<POSTGRES_DB>',
        ].join('\n'),
        value: EXTERNAL_URL_PLACEHOLDER,
      },
      {
        key: 'NEXUS_APP_DB_PASSWORD',
        description: [
          'ONLY for DB_APP_ROLE_MODE=separate (leave empty in owner mode): the password migrate sets on',
          'role nexus_app on EVERY run (rotate = change it + DATABASE_URL, redeploy). Hex: openssl rand -hex 32.',
        ].join('\n'),
        value: '',
      },
      {
        key: 'BACKUP_DATABASE_URL',
        description:
          'What pg-backup dumps nightly. Empty = MIGRATION_DATABASE_URL (the usual choice).',
        value: '',
      },
      {
        key: 'BACKUP_AT_IST',
        description: 'Time of the nightly pg-backup dump, HH:MM in IST (Asia/Kolkata).',
        value: '01:30',
      },
      {
        key: 'BACKUP_KEEP',
        description: 'How many dump files pg-backup keeps in ./backups (newest first; older ones are deleted).',
        value: '14',
      },
      { key: 'PG_POOL_WRITE_MAX', description: 'api connections for ingest/admin writes.' },
      { key: 'PG_POOL_QUERY_MAX', description: 'api connections for dashboard reads.' },
    ],
  },
  {
    title: `Local Postgres container (${LOCALDB_NOTE})`,
    notes: [
      'Read only by the postgres service of profile localdb (and its first-start initdb).',
      'Production on the external server ignores them (preflight.sh checks them only with --localdb).',
    ],
    keys: [
      {
        key: 'PG_IMAGE',
        description:
          'Image for the localdb postgres AND pg-backup. pg_dump must be >= the server major (18).',
        value: 'postgres:18-alpine',
      },
      {
        key: 'POSTGRES_USER',
        description: `Database OWNER role of the local container (${LOCALDB_NOTE}).`,
        value: 'nexus_owner',
      },
      {
        key: 'POSTGRES_PASSWORD',
        description: `Owner password (${LOCALDB_NOTE}). Hex only: openssl rand -hex 32.`,
        value: SECRET_PLACEHOLDER,
      },
      {
        key: 'POSTGRES_DB',
        description: `Database name of the local container (${LOCALDB_NOTE}).`,
        value: 'nexus_traffic',
      },
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
        description: [
          'Proxies in front of the api: gateway nginx → edge nginx (compose) = 2.',
          'Used to find the real client IP in X-Forwarded-For. Never applies to the body `ip`.',
        ].join('\n'),
        value: '2',
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
        key: 'INGEST_RATE_LIMIT_BROWSER_PER_MIN',
        description: 'Browser beacons per publishable key per minute (all sessions of one app).',
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
        description: 'Port inside the container (internal only; the edge nginx reaches api:4000).',
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
  '# Local stack:   same, but DB_APP_ROLE_MODE=separate + the localdb values → preflight.sh --localdb',
  '# Generated secrets must be hex (openssl rand -hex 32) so they never need escaping inside URLs.',
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

/** `# line` per line of text (WHY: multi-line descriptions stay readable in the file). */
function commentLines(text: string): string[] {
  return text.split('\n').map((line) => `# ${line}`.trimEnd());
}

function renderKey(spec: KeySpec, defaults: Map<string, string | undefined>): string[] {
  const value = formatValue(spec.value ?? defaults.get(spec.key) ?? '');
  const commented = (IMAGE_MANAGED_KEYS as readonly string[]).includes(spec.key);
  return [...commentLines(spec.description), `${commented ? '# ' : ''}${spec.key}=${value}`];
}

function renderSection(section: Section, defaults: Map<string, string | undefined>): string[] {
  const banner = `# ─── ${section.title} `;
  return [
    '',
    banner.padEnd(79, '─'),
    ...(section.notes ?? []).flatMap((note) => commentLines(note)),
    ...(section.notes?.length ? ['#'] : []),
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
