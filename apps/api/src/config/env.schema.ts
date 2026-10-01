/**
 * Every environment variable the api reads — THE list (scripts/generate-env-example.ts builds
 * .env.example from this schema, the web env schema and COMPOSE_ONLY_KEYS).
 *
 * Unknown keys are stripped (the shared .env also holds web/compose keys). Secrets must be long
 * hex strings (`openssl rand -hex 32`) so they never need URL escaping.
 */
import { z } from 'zod';

import { IP_STORAGE_MODE_VALUES, PUBLIC_BASE_PATH } from '@nexus/shared';

const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters (use: openssl rand -hex 32)`);

const csv = z.string().default('');

export const apiEnvSchema = z.object({
  // ─── Runtime ──────────────────────────────────────────────────────────────
  /** production | development | test */
  NODE_ENV: z.enum(['production', 'development', 'test']).default('development'),
  /** Port the api listens on inside the container (compose maps 127.0.0.1:4005 → 4000). */
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** debug | info | warn | error */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ─── Database (runtime role nexus_app) ────────────────────────────────────
  /** postgres://nexus_app:<NEXUS_APP_DB_PASSWORD>@postgres:5432/<POSTGRES_DB> */
  DATABASE_URL: z.string().url(),
  /** Connections for ingest/admin writes. */
  PG_POOL_WRITE_MAX: z.coerce.number().int().min(1).max(50).default(4),
  /** Connections for dashboard reads (read-only transactions). */
  PG_POOL_QUERY_MAX: z.coerce.number().int().min(1).max(50).default(6),

  // ─── SSO (shared with the portal) ─────────────────────────────────────────
  /** The portal's JWT_SECRET_KEY — verifies the `access_token` cookie. Runtime only, NEVER a build arg. */
  LIBAS_JWT_SECRET: z.string().min(1),
  /** Public origin, used for absolute links (docs, redirects). */
  PUBLIC_ORIGIN: z.string().url().default('https://nexus.libas.in'),
  /** Public URL prefix; fixed by the shared constant, overridable only for unusual gateways. */
  PUBLIC_BASE_PATH: z.string().default(PUBLIC_BASE_PATH),

  // ─── Dashboard access policy (same values as the web container) ───────────
  /** Comma-separated emails allowed to open the dashboard. If set, ONLY these (+admins) may. */
  DASHBOARD_ALLOWED_EMAILS: csv,
  /** Used only when DASHBOARD_ALLOWED_EMAILS is empty. */
  DASHBOARD_ALLOWED_DOMAINS: z.string().default('libas.in'),
  /** Admins: manage apps/keys and see IP addresses. */
  DASHBOARD_ADMIN_EMAILS: csv,

  // ─── Secrets ──────────────────────────────────────────────────────────────
  /** HMAC pepper for API key hashes. Changing it invalidates every issued key. */
  API_KEY_PEPPER: secret('API_KEY_PEPPER'),
  /** HMAC secret for user keys (opaque user ids in URLs). Changing it re-keys user links. */
  USER_KEY_SECRET: secret('USER_KEY_SECRET'),
  /** HMAC secret for ip_hash. */
  IP_HASH_SECRET: secret('IP_HASH_SECRET'),

  // ─── Privacy & retention ──────────────────────────────────────────────────
  /** full | truncated (/24, /48) | hashed (no IP kept, only ip_hash). Geo is resolved first either way. */
  IP_STORAGE_MODE: z.enum(IP_STORAGE_MODE_VALUES).default('full'),
  /** Months of raw events kept; older monthly partitions are dropped nightly. */
  RAW_RETENTION_MONTHS: z.coerce.number().int().min(1).max(60).default(6),

  // ─── Network & ingest ─────────────────────────────────────────────────────
  /** Proxies in front of the api (gateway nginx = 1). Used for req.ip on browser beacons. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** Extra browser origins allowed in development (comma-separated). */
  CORS_DEV_ORIGINS: csv,
  INGEST_RATE_LIMIT_SERVER_PER_MIN: z.coerce.number().int().min(1).default(600),
  INGEST_RATE_LIMIT_BROWSER_PER_SESSION_PER_MIN: z.coerce.number().int().min(1).default(60),
  /** Failed key authentications allowed per IP per minute. */
  INGEST_IP_FAILURE_PER_MIN: z.coerce.number().int().min(1).default(60),

  // ─── Docs ─────────────────────────────────────────────────────────────────
  /** Who other teams contact for keys (rendered into the public guide). */
  DOCS_CONTACT: z.string().default('the Data Nexus team'),
  /** Directory of the built docs site; defaults to <repo>/docs/dist. */
  DOCS_DIR: z.string().optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
