/**
 * Mint a LOCAL-ONLY portal `access_token` so the dashboard can be opened without the portal.
 *
 * WHY: locally there is no nexus.libas.in login to issue the SSO cookie, but both the web proxy
 * (apps/web/src/proxy.ts) and the api (sso-auth.middleware.ts) verify it. This signs exactly what
 * the portal signs — HS256 over `{ email, type: 'access', iat, exp }` with LIBAS_JWT_SECRET from
 * the repo-root .env — valid for 8 hours. It NEVER prints the secret, only the token.
 *
 * Usage (repo root):
 *   npx tsx scripts/mint-dev-token.ts you@libas.in
 *   npx tsx scripts/mint-dev-token.ts you@libas.in --set-cookie-header
 *
 * Then set the cookie for localhost (cookies ignore the port, so it works on :3305 and :8080):
 *   DevTools → Application → Cookies → http://localhost → add `access_token` = <token>, Path `/`.
 *   Or with --set-cookie-header: paste the printed `Set-Cookie` value into any tool that replays
 *   it (e.g. curl -H "Cookie: access_token=<token>").
 *
 * NEVER use the production secret on a laptop; .env for local work has its own random secret.
 *
 * @see ../packages/auth/src/verify-access-token.ts   what the token must satisfy
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ACCESS_TOKEN_COOKIE } from '../packages/auth/src/verify-access-token';
import { PUBLIC_BASE_PATH } from '../packages/shared/src/constants/time';

const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const SET_COOKIE_FLAG = '--set-cookie-header';
const ENV_FILE = path.join(__dirname, '..', '.env');
const SECRET_KEY = 'LIBAS_JWT_SECRET';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** HS256 JWT in the portal's shape. */
export function signAccessToken(email: string, secret: string, nowMs: number = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({
    email,
    sub: email,
    type: 'access',
    iat,
    exp: iat + TOKEN_LIFETIME_SECONDS,
  });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** The Set-Cookie value a local server would send (Path=/ so /traffic and /traffic/api get it). */
export function toSetCookie(token: string): string {
  return `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; Max-Age=${TOKEN_LIFETIME_SECONDS}; HttpOnly; SameSite=Lax`;
}

function readSecret(): string {
  if (!process.env[SECRET_KEY] && fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const secret = process.env[SECRET_KEY];
  if (!secret) throw new Error(`${SECRET_KEY} is not set (expected in ${ENV_FILE})`);
  return secret;
}

function main(argv: readonly string[]): void {
  const email = argv
    .find((arg) => !arg.startsWith('--'))
    ?.trim()
    .toLowerCase();
  if (!email || !EMAIL_SHAPE.test(email)) {
    console.error(`usage: npx tsx scripts/mint-dev-token.ts <email> [${SET_COOKIE_FLAG}]`);
    process.exit(1);
  }
  const token = signAccessToken(email, readSecret());
  if (argv.includes(SET_COOKIE_FLAG)) {
    console.log(toSetCookie(token));
    return;
  }
  console.log(token);
  console.error(
    [
      '',
      `Valid for ${TOKEN_LIFETIME_SECONDS / 3600} h for ${email}. Set it as a cookie on localhost:`,
      `  DevTools → Application → Cookies → http://localhost → name "${ACCESS_TOKEN_COOKIE}", path "/".`,
      `Then open http://localhost:3305${PUBLIC_BASE_PATH}/ (next dev) or http://localhost:8080${PUBLIC_BASE_PATH}/ (edge).`,
      'The email must pass DASHBOARD_ALLOWED_EMAILS / DASHBOARD_ALLOWED_DOMAINS in .env.',
    ].join('\n'),
  );
}

if (require.main === module) main(process.argv.slice(2));
