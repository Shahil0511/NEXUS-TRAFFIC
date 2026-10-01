/**
 * The Dev Launcher: a tiny node:http server on 127.0.0.1 serving ONE page plus a few JSON actions.
 *
 * WHY: one place to see whether the dev stack is up, sign in without the company portal, seed a
 * demo app and push sample traffic — no extra dependency, no framework.
 *
 * SECURITY (it can mint dashboard tokens, so it must stay a local-only tool):
 * - binds to 127.0.0.1 only and refuses to run when NODE_ENV=production;
 * - answers ONLY when the Host header is localhost:<port> / 127.0.0.1:<port> (DNS-rebinding guard);
 * - POSTs with an Origin header must come from the launcher's own origin, and JSON actions also need
 *   the custom header `X-Dev-Launcher: 1` (a cross-site page cannot send it without a CORS
 *   preflight, which this server never approves);
 * - secrets never reach the console; full demo keys are sent only to the page's copy button.
 */
import { randomBytes } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import { decideDashboardAccess, plausibleEmail, readCookie, verifyAccessToken, ACCESS_TOKEN_COOKIE } from '@nexus/auth';

import { DEFAULT_ADMIN_EMAIL, DEFAULT_VIEWER_EMAIL, DEV_ALLOWED_DOMAIN } from './child-env';
import { DashboardApi, DashboardApiError } from './dashboard-api';
import { readDevEnvFile } from './env-file';
import { renderLauncherPage, LAUNCHER_ROUTES, LAUNCHER_ACTION_HEADER } from './launcher-page';
import { isLogSource, log, tailLog, warn } from './log';
import { safeReturnUrl } from './return-url';
import { sendSampleTraffic, clampSampleCount } from './sample-traffic';
import { seedDemoApp } from './seed';
import type { StatusCollector } from './status';
import { accessTokenSetCookie, clearAccessTokenSetCookie, mintAccessToken } from './token';
import { DEV_URLS } from './topology';

const MAX_BODY_BYTES = 64 * 1024;

export interface LauncherDeps {
  envFile: string;
  jwtSecret: string;
  adminEmails: string[];
  status: StatusCollector;
  /** Where sign-in goes without a `return` parameter (the dashboard, or the launcher when it is down). */
  defaultReturnUrl: () => string;
  /**
   * Graceful stop of the whole dev environment ("Stop all" / npm run dev:stop).
   * `dbStopping` is true when the caller (dev:stop / dev:reset) stops the dev DB right after.
   */
  onShutdown: (options: { dbStopping: boolean }) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ─── Small HTTP helpers ──────────────────────────────────────────────────────

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...BASE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string, setCookie?: string): void {
  res.writeHead(303, { ...BASE_HEADERS, Location: location, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) });
  res.end();
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Form (urlencoded) or JSON body → flat string map. */
async function readFields(req: IncomingMessage): Promise<Record<string, string>> {
  const text = await readBody(req);
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) {
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new HttpError(400, 'invalid JSON');
    }
    if (parsed === null || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(text));
}

// ─── Guards ──────────────────────────────────────────────────────────────────

function allowedHosts(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
}

function assertLocalRequest(req: IncomingMessage, port: number): void {
  const hosts = allowedHosts(port);
  if (!hosts.has(req.headers.host ?? '')) throw new HttpError(403, 'launcher answers on localhost only');
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin !== undefined && !hosts.has(origin.replace(/^http:\/\//, ''))) {
    throw new HttpError(403, 'cross-origin request refused');
  }
}

function assertActionHeader(req: IncomingMessage): void {
  if (req.headers[LAUNCHER_ACTION_HEADER.toLowerCase()] !== '1') {
    throw new HttpError(403, `missing ${LAUNCHER_ACTION_HEADER} header`);
  }
}

// ─── The server ──────────────────────────────────────────────────────────────

export interface Viewer {
  email: string;
  isAdmin: boolean;
  allowed: boolean;
}

/** WHY a class: holds the deps + bound port and keeps each route handler a small method. */
export class LauncherServer {
  readonly server: http.Server;
  private readonly api: DashboardApi;

  constructor(private readonly deps: LauncherDeps) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('The Dev Launcher never runs with NODE_ENV=production.');
    }
    this.api = new DashboardApi(() => this.adminToken());
    this.server = http.createServer((req, res) => void this.handle(req, res));
  }

  get port(): number {
    const address = this.server.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  get origin(): string {
    return `http://localhost:${this.port}`;
  }

  private adminToken(): string {
    return mintAccessToken(this.deps.adminEmails[0] ?? DEFAULT_ADMIN_EMAIL, this.deps.jwtSecret).token;
  }

  private viewerOf(req: IncomingMessage): Viewer | null {
    const token = readCookie(req.headers.cookie, ACCESS_TOKEN_COOKIE);
    if (!token) return null;
    const result = verifyAccessToken(token, this.deps.jwtSecret);
    if (!result.ok) return null;
    const decision = decideDashboardAccess(result.email, {
      allowedEmails: [],
      allowedDomains: [DEV_ALLOWED_DOMAIN],
      adminEmails: this.deps.adminEmails,
    });
    return { email: result.email, isAdmin: decision.isAdmin, allowed: decision.allowed };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      assertLocalRequest(req, this.port);
      const url = new URL(req.url ?? '/', this.origin);
      await this.route(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status === 500) warn('launcher', `request failed: ${message}`);
      if (!res.headersSent) sendJson(res, status, { error: message });
      else res.end();
    }
  }

  private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const key = `${req.method ?? 'GET'} ${url.pathname}`;
    switch (key) {
      case `GET ${LAUNCHER_ROUTES.page}`:
        return this.page(res, url);
      case `GET ${LAUNCHER_ROUTES.status}`:
        return sendJson(res, 200, { ...(await this.deps.status.collect()), viewer: this.viewerOf(req), launcher: this.origin });
      case `GET ${LAUNCHER_ROUTES.logs}`:
        return this.logs(res, url);
      case `GET ${LAUNCHER_ROUTES.ping}`:
        return sendJson(res, 200, { service: 'nexus-dev-launcher' });
      case `POST ${LAUNCHER_ROUTES.signIn}`:
        return this.signIn(req, res);
      case `POST ${LAUNCHER_ROUTES.signOut}`:
        return redirect(res, LAUNCHER_ROUTES.page, clearAccessTokenSetCookie());
      case `POST ${LAUNCHER_ROUTES.seed}`:
        assertActionHeader(req);
        return this.seed(res);
      case `POST ${LAUNCHER_ROUTES.traffic}`:
        assertActionHeader(req);
        return this.traffic(req, res);
      case `GET ${LAUNCHER_ROUTES.demoKeys}`:
        assertActionHeader(req);
        return this.demoKeys(res);
      case `POST ${LAUNCHER_ROUTES.shutdown}`: {
        assertActionHeader(req);
        const dbStopping = (await readFields(req)).dbStopping === 'true';
        sendJson(res, 202, { stopping: true });
        setImmediate(() => this.deps.onShutdown({ dbStopping }));
        return;
      }
      default:
        throw new HttpError(404, 'not found');
    }
  }

  private page(res: ServerResponse, url: URL): void {
    const nonce = randomBytes(16).toString('base64');
    const returnParam = url.searchParams.get('return');
    const html = renderLauncherPage({
      nonce,
      signInRequired: returnParam !== null,
      returnUrl: returnParam === null ? null : safeReturnUrl(returnParam, DEV_URLS.dashboard),
      defaultEmail: DEFAULT_ADMIN_EMAIL,
      viewerEmail: DEFAULT_VIEWER_EMAIL,
      adminEmails: this.deps.adminEmails,
      urls: DEV_URLS,
    });
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      `style-src 'nonce-${nonce}'`,
      "connect-src 'self'",
      "img-src 'self' data:",
      "form-action 'self' http://localhost:* http://127.0.0.1:*",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
    res.end(html);
  }

  private logs(res: ServerResponse, url: URL): void {
    const proc = url.searchParams.get('proc');
    if (!isLogSource(proc)) throw new HttpError(400, 'unknown proc');
    sendJson(res, 200, { proc, lines: tailLog(proc) });
  }

  private async signIn(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fields = await readFields(req);
    const email =
      fields.role === 'viewer' ? DEFAULT_VIEWER_EMAIL : (plausibleEmail(fields.email) ?? DEFAULT_ADMIN_EMAIL);
    const { token } = mintAccessToken(email, this.deps.jwtSecret);
    const target = safeReturnUrl(fields.return, this.deps.defaultReturnUrl());
    log('launcher', `signed in as ${email.replace(/^(.).*@/, '$1***@')} → ${new URL(target).host}`);
    redirect(res, target, accessTokenSetCookie(token));
  }

  private async seed(res: ServerResponse): Promise<void> {
    try {
      const result = await seedDemoApp(this.api, this.deps.envFile, this.origin);
      sendJson(res, 200, {
        appSlug: result.appSlug,
        appCreated: result.appCreated,
        keys: result.keys.map(({ kind, prefix, created }) => ({ kind, prefix, created })),
      });
    } catch (err) {
      throw this.upstreamError(err, 'seeding failed');
    }
  }

  private async traffic(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const fields = await readFields(req);
    const secretKey = readDevEnvFile(this.deps.envFile)?.DEMO_SECRET_KEY;
    if (!secretKey) throw new HttpError(409, 'No demo key yet — click "Seed demo data" first.');
    const count = clampSampleCount(fields.count);
    try {
      const result = await sendSampleTraffic(secretKey, count);
      log('launcher', `sample traffic: ${result.accepted} accepted, ${result.duplicates} duplicates, ${result.rejected} rejected`);
      sendJson(res, 200, result);
    } catch (err) {
      throw this.upstreamError(err, 'sending traffic failed');
    }
  }

  private demoKeys(res: ServerResponse): void {
    const values = readDevEnvFile(this.deps.envFile);
    sendJson(res, 200, {
      secret: values?.DEMO_SECRET_KEY ?? null,
      publishable: values?.DEMO_PUBLISHABLE_KEY ?? null,
    });
  }

  /** API down / API error → 502 with a readable message for the page. */
  private upstreamError(err: unknown, what: string): HttpError {
    if (err instanceof HttpError) return err;
    if (err instanceof DashboardApiError) return new HttpError(502, `${what}: ${err.message}`);
    const message = err instanceof Error ? err.message : String(err);
    const refused = /fetch failed|ECONNREFUSED/i.test(message);
    return new HttpError(502, refused ? `${what}: the API is not running yet` : `${what}: ${message}`);
  }
}
