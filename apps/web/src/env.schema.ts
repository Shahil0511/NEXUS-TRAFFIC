/**
 * Server-side environment of the web container (read by src/proxy.ts and server components).
 *
 * WHY: the container receives an explicit allowlist from docker-compose.yml (`web.environment`);
 * parsing it with zod gives typed values, defaults identical to the api's, and one error naming
 * every missing key. `.strip()` drops unrelated variables. NEVER import this from a client
 * component: LIBAS_JWT_SECRET must stay on the server.
 *
 * @see ../../api/src/config/env.schema.ts   the api reads the same SSO + DASHBOARD_* keys
 * @see ../../../scripts/generate-env-example.ts   WEB_KEYS (documented in .env.example)
 */
import { parseList, type DashboardAccessPolicy } from '@nexus/auth';
import { z } from 'zod';

/** A query-parameter name the portal understands (e.g. `return`). */
const QUERY_PARAM_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const webEnvSchema = z
  .object({
    /** The portal's JWT secret: verifies the access_token cookie. Runtime only. */
    LIBAS_JWT_SECRET: z.string().min(1),
    /** Where signed-out users go, e.g. https://nexus.libas.in/login. */
    PORTAL_LOGIN_URL: z.url(),
    /** Query parameter carrying the return URL. */
    PORTAL_RETURN_PARAM: z.string().regex(QUERY_PARAM_NAME).default('return'),
    /** Public origin; the return URL is built from it, NEVER from the Host header. */
    PUBLIC_ORIGIN: z
      .url()
      .default('https://nexus.libas.in')
      .transform((origin) => new URL(origin).origin),
    DASHBOARD_ALLOWED_EMAILS: z.string().default(''),
    DASHBOARD_ALLOWED_DOMAINS: z.string().default('libas.in'),
    DASHBOARD_ADMIN_EMAILS: z.string().default(''),
    /** `next dev` rewrite target only (next.config.ts reads it directly). */
    API_INTERNAL_URL: z.url().default('http://localhost:4000'),
    /**
     * `next dev` ONLY: no portal in front of the dev server, so the proxy signs in as this email
     * (like EBO_SALES' DEV_USER_EMAIL). Ignored when NODE_ENV is not 'development'.
     */
    DEV_USER_EMAIL: z.email().optional(),
  })
  .strip();

export type WebEnv = z.infer<typeof webEnvSchema>;

export class WebEnvError extends Error {}

/** Parse `source` (default process.env); throws one error listing every invalid key. */
export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new WebEnvError(`web env invalid or missing: ${keys.join(', ')}`);
  }
  return result.data;
}

/** The dashboard access policy from env — the same lists the api parses (ADR 0001). */
export function accessPolicyOf(env: WebEnv): DashboardAccessPolicy {
  return {
    allowedEmails: parseList(env.DASHBOARD_ALLOWED_EMAILS),
    allowedDomains: parseList(env.DASHBOARD_ALLOWED_DOMAINS),
    adminEmails: parseList(env.DASHBOARD_ADMIN_EMAILS),
  };
}
