/**
 * SSO gate + Content-Security-Policy of the dashboard (Next 16 `proxy.ts`, Node.js runtime).
 *
 * WHY: users arrive with the portal's `access_token` cookie (HS256, LIBAS_JWT_SECRET). This proxy
 * is the UX gate — signed-out users go to the portal login with a return URL, signed-in users who
 * are not on the access policy see /no-access (403). It is NOT the security boundary: the api
 * re-verifies the cookie and the policy on every request
 * (apps/api/src/http/middleware/sso-auth.middleware.ts). It also issues a per-request CSP nonce,
 * which Next applies to its own scripts and which next-themes receives through the `x-nonce`
 * request header (src/app/layout.tsx).
 *
 * RULES
 * - The return URL is built from PUBLIC_ORIGIN + basePath + path + search, NEVER from the Host
 *   header (an attacker-controlled Host must not become an open redirect at the portal).
 * - Runs on the Node.js runtime (the Next 16 proxy default) because @nexus/auth uses node:crypto.
 *
 * @see ../../../packages/auth/src/verify-access-token.ts
 * @see ../../../packages/auth/src/dashboard-access.ts
 * @see ./env.schema.ts
 * @see ./lib/csp.ts
 */
import { ACCESS_TOKEN_COOKIE, decideDashboardAccess, verifyAccessToken } from '@nexus/auth';
import { PUBLIC_BASE_PATH } from '@nexus/shared';
import { NextResponse, type NextRequest } from 'next/server';

import { accessPolicyOf, loadWebEnv, type WebEnv } from './env.schema';
import { buildCsp, createNonce, CSP_HEADER, NONCE_HEADER } from './lib/csp';
import { PAGES } from './lib/pages';

const HTTP_STATUS_FORBIDDEN = 403;

// ─── Decisions ───────────────────────────────────────────────────────────────

/** `${PORTAL_LOGIN_URL}?return=<public URL of the requested page>`. */
export function buildLoginRedirectUrl(req: NextRequest, env: WebEnv): string {
  const { pathname, search } = req.nextUrl;
  const returnTo = `${env.PUBLIC_ORIGIN}${PUBLIC_BASE_PATH}${pathname}${search}`;
  const separator = env.PORTAL_LOGIN_URL.includes('?') ? '&' : '?';
  return `${env.PORTAL_LOGIN_URL}${separator}${env.PORTAL_RETURN_PARAM}=${encodeURIComponent(returnTo)}`;
}

/** The verified email of the request's access_token cookie, or null. */
export function readVerifiedEmail(
  req: NextRequest,
  env: WebEnv,
  nowMs: number = Date.now(),
): string | null {
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;
  const result = verifyAccessToken(token, env.LIBAS_JWT_SECRET, nowMs);
  return result.ok ? result.email : null;
}

/** Request headers for the render: the nonce, plus the CSP Next extracts it from. */
function renderHeaders(req: NextRequest, csp: string, nonce: string): Headers {
  const headers = new Headers(req.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set(CSP_HEADER, csp);
  return headers;
}

/**
 * Rewrite (the address bar keeps the URL) to the no-access page. The 403 set here is what the
 * proxy decides; Next drops a rewrite's status, so the page itself throws forbidden() to make
 * the HTTP response a 403 too (src/app/no-access/page.tsx).
 */
function forbidden(req: NextRequest, headers: Headers): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = PAGES.noAccess();
  url.search = '';
  return NextResponse.rewrite(url, { status: HTTP_STATUS_FORBIDDEN, request: { headers } });
}

// ─── Entry ───────────────────────────────────────────────────────────────────

export interface GateOptions {
  nowMs?: number;
  isDev?: boolean;
}

/**
 * The gate itself, with the env injected (src/proxy.test.ts runs it with a test secret):
 * no/invalid cookie → portal login; valid but not on the policy → /no-access 403; else render
 * with a fresh CSP nonce.
 */
export function gateRequest(
  req: NextRequest,
  env: WebEnv,
  options: GateOptions = {},
): NextResponse {
  const email = readVerifiedEmail(req, env, options.nowMs);
  if (!email) return NextResponse.redirect(buildLoginRedirectUrl(req, env));

  const nonce = createNonce();
  const csp = buildCsp(nonce, options.isDev ?? false);
  const headers = renderHeaders(req, csp, nonce);
  const response = decideDashboardAccess(email, accessPolicyOf(env)).allowed
    ? NextResponse.next({ request: { headers } })
    : forbidden(req, headers);
  response.headers.set(CSP_HEADER, csp);
  return response;
}

let cachedEnv: WebEnv | undefined;

/** Parsed once per process: the container env never changes after start. */
function webEnv(): WebEnv {
  cachedEnv ??= loadWebEnv();
  return cachedEnv;
}

export function proxy(req: NextRequest): NextResponse {
  return gateRequest(req, webEnv(), { isDev: process.env.NODE_ENV === 'development' });
}

/**
 * Everything except the health check, the no-access page, the dev API rewrite (`api/`, a fetch
 * must get the api's 401 JSON, not a redirect), the dev Socket.io rewrite (`socket.io/`, the api
 * authenticates the handshake itself) and static files. Next prefixes the basePath
 * itself. MUST stay a literal: Next analyses it at build time.
 */
export const config = {
  matcher: [
    // The basePath root itself (`/traffic`, no trailing slash) is NOT covered by the pattern below.
    '/',
    '/((?!api/|socket.io/|healthz|no-access|_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)',
  ],
};
