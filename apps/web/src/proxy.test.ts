// @vitest-environment node
/**
 * The SSO gate (src/proxy.ts) with a TEST secret — never the real LIBAS_JWT_SECRET.
 */
import { createHmac } from 'node:crypto';

import { PUBLIC_BASE_PATH } from '@nexus/shared';
import {
  getRedirectUrl,
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GET as healthz } from './app/healthz/route';
import { webEnvSchema, type WebEnv } from './env.schema';
import { CSP_HEADER } from './lib/csp';
import { config, gateRequest } from './proxy';

const TEST_SECRET = 'test-secret-not-the-portal-one';
const NOW_MS = Date.parse('2026-10-01T08:00:00Z');
const HOUR_S = 3600;

const ENV: WebEnv = webEnvSchema.parse({
  LIBAS_JWT_SECRET: TEST_SECRET,
  PORTAL_LOGIN_URL: 'https://nexus.libas.in/login',
  PUBLIC_ORIGIN: 'https://nexus.libas.in',
  DASHBOARD_ALLOWED_EMAILS: '',
  DASHBOARD_ALLOWED_DOMAINS: 'libas.in',
  DASHBOARD_ADMIN_EMAILS: 'boss@partner.com',
});

const NEXT_CONFIG = { basePath: PUBLIC_BASE_PATH };

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A portal-style HS256 access token. */
function signToken(claims: Record<string, unknown>, secret = TEST_SECRET): string {
  const head = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url({ type: 'access', exp: NOW_MS / 1000 + HOUR_S, ...claims });
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

function requestFor(pathAndSearch: string, token?: string): NextRequest {
  return new NextRequest(`http://internal-host:3000${PUBLIC_BASE_PATH}${pathAndSearch}`, {
    headers: token ? { cookie: `access_token=${token}` } : {},
    nextConfig: NEXT_CONFIG,
  });
}

describe('proxy matcher', () => {
  it('skips the health check, the no-access page and static assets', () => {
    for (const path of [
      '/healthz',
      '/no-access',
      '/_next/static/chunk.js',
      '/favicon.ico',
      '/socket.io/?EIO=4&transport=polling',
    ]) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: NEXT_CONFIG,
          url: `${PUBLIC_BASE_PATH}${path}`,
        }),
        path,
      ).toBe(false);
    }
  });

  it('gates every page', () => {
    for (const path of ['', '/', '/endpoints', '/errors?range=7d']) {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: NEXT_CONFIG,
          url: `${PUBLIC_BASE_PATH}${path}`,
        }),
        path,
      ).toBe(true);
    }
  });

  it('/healthz answers 200 "ok" without any cookie', async () => {
    const response = healthz();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });
});

describe('gateRequest', () => {
  it('redirects a request without a cookie to the portal with the PUBLIC return URL', () => {
    const response = gateRequest(requestFor('/endpoints?range=7d&app=ebo-sales'), ENV, {
      nowMs: NOW_MS,
    });
    const location = getRedirectUrl(response);
    expect(location).toBe(
      `https://nexus.libas.in/login?return=${encodeURIComponent(
        'https://nexus.libas.in/traffic/endpoints?range=7d&app=ebo-sales',
      )}`,
    );
    // The Host header (internal-host:3000) never leaks into the return URL.
    expect(location).not.toContain('internal-host');
  });

  it('redirects an invalid, expired or foreign-signed token', () => {
    const tokens = [
      'not-a-jwt',
      signToken({ email: 'a@libas.in', exp: NOW_MS / 1000 - 1 }),
      signToken({ email: 'a@libas.in' }, 'another-secret'),
      signToken({ email: 'a@libas.in', type: 'refresh' }),
    ];
    for (const token of tokens) {
      const response = gateRequest(requestFor('/', token), ENV, { nowMs: NOW_MS });
      expect(getRedirectUrl(response), token).toMatch(
        /^https:\/\/nexus\.libas\.in\/login\?return=/,
      );
    }
  });

  it('lets an allowed user through with a nonce CSP on the response', () => {
    const response = gateRequest(
      requestFor('/errors', signToken({ email: 'Viewer@Libas.in' })),
      ENV,
      {
        nowMs: NOW_MS,
      },
    );
    expect(getRedirectUrl(response)).toBeNull();
    expect(isRewrite(response)).toBe(false);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    const csp = response.headers.get(CSP_HEADER) ?? '';
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-eval');
  });

  it('admits admins outside the allowed domains', () => {
    const response = gateRequest(requestFor('/', signToken({ email: 'boss@partner.com' })), ENV, {
      nowMs: NOW_MS,
    });
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('rewrites a signed-in user who is not on the policy to /no-access with 403', () => {
    const response = gateRequest(
      requestFor('/endpoints?range=7d', signToken({ email: 'outsider@gmail.com' })),
      ENV,
      { nowMs: NOW_MS },
    );
    expect(response.status).toBe(403);
    expect(isRewrite(response)).toBe(true);
    expect(new URL(getRewrittenUrl(response)!).pathname).toBe(`${PUBLIC_BASE_PATH}/no-access`);
    expect(response.headers.get(CSP_HEADER)).toBeTruthy();
  });

  it('a non-empty email allowlist overrides the domain list (fail-closed)', () => {
    const strict = { ...ENV, DASHBOARD_ALLOWED_EMAILS: 'only@libas.in' };
    const denied = gateRequest(requestFor('/', signToken({ email: 'other@libas.in' })), strict, {
      nowMs: NOW_MS,
    });
    expect(denied.status).toBe(403);
    const allowed = gateRequest(requestFor('/', signToken({ email: 'only@libas.in' })), strict, {
      nowMs: NOW_MS,
    });
    expect(allowed.headers.get('x-middleware-next')).toBe('1');
  });
});
