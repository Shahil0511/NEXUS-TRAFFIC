/**
 * Data Nexus Traffic — reference Express middleware (TypeScript, ES modules).
 *
 * Copy this file into your backend (e.g. `src/nexus.ts`). Node >= 18 (global fetch), Express 4 or 5,
 * ZERO runtime dependencies (`@types/express` for types). Works with ESM, NodeNext and — compiled by
 * tsc — CommonJS (NestJS: see nestjs.main.ts). It NEVER throws into your app and NEVER blocks a
 * response: if Nexus is down, events are dropped after the retry rules below.
 *
 *   import { createNexusClient, nexusMiddleware } from './nexus.js';
 *   const nexus = createNexusClient({ url: process.env.NEXUS_URL, key: process.env.NEXUS_SECRET_KEY });
 *   app.use(nexusMiddleware({ client: nexus, basePath: '/my-app', trustProxyHops: 1,
 *                             getUser: (req) => emailFrom(req) }));
 *   // in your existing shutdown handler:  await nexus.shutdown();
 *
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

// ─── Contract constants (v1) ────────────────────────────────────────────────
const SERVER_INGEST_PATH = '/api/v1/ingest/server';
const KEY_HEADER = 'X-Nexus-Key';
const MAX_EVENTS_PER_REQUEST = 500;
const LIMITS = {
  path: 2048,
  routeTemplate: 256,
  email: 254,
  userAgent: 4096,
  requestId: 128,
  release: 64,
};
const MAX_DURATION_MS = 3_600_000;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Batching / retry defaults ──────────────────────────────────────────────
const FLUSH_EVERY_EVENTS = 100;
const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE = 5_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;
const AUTH_PAUSE_MS = 5 * 60 * 1_000;
const DEFAULT_RETRY_AFTER_S = 5;
const MAX_RETRY_AFTER_S = 60;

const SKIP_SUFFIXES = ['/health', '/healthz', '/ready', '/live', '/metrics', '/favicon.ico'];
const SKIP_EXTENSIONS = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf)$/i;

// ─── Types ──────────────────────────────────────────────────────────────────

/** One element of `events[]` (guide chapter 2). */
export interface NexusServerEvent {
  eventId: string;
  kind: 'http' | 'stream';
  occurredAt: string;
  method: string;
  path: string;
  routeTemplate?: string;
  status: number;
  durationMs: number;
  ip?: string;
  userEmail?: string;
  requestId?: string;
  userAgent?: string;
  requestBytes?: number;
  responseBytes?: number;
  errorCode?: string;
  release?: string;
  sessionId?: string;
  pageViewId?: string;
}

export interface NexusClient {
  track(event: NexusServerEvent): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  stats(): { queued: number; dropped: number };
}

export interface NexusClientOptions {
  /** NEXUS_URL, e.g. https://nexus.libas.in/traffic. Unset → a no-op client. */
  url?: string;
  /** NEXUS_SECRET_KEY (`nx_sk_…`). Server env ONLY. */
  key?: string;
  sdkName?: string;
  sdkVersion?: string;
  logger?: Pick<Console, 'warn'>;
}

export interface NexusMiddlewareOptions {
  client: NexusClient;
  /** Public prefix your gateway strips before Express sees the request ('' if none). */
  basePath?: string;
  /** Proxies YOU run in front of this app: gateway → app = 1; gateway → Next → app = 2. */
  trustProxyHops: number;
  /** Your VERIFIED signed-in user's email, read when the response ends. */
  getUser?: (req: Request) => string | null | undefined;
  /** Your app's error CODE for this response (never a message). */
  getErrorCode?: (req: Request, res: Response) => string | null | undefined;
  skip?: (req: Request) => boolean;
  classify?: (req: Request, res: Response) => 'http' | 'stream';
  release?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

function normalizeIp(value: string): string {
  const v = value.trim();
  return v.toLowerCase().startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v;
}

/**
 * The end-user IP, walking X-Forwarded-For from the RIGHT by the number of proxies YOU run.
 * NEVER take the leftmost entry: the client can write anything there.
 */
export function resolveClientIp(
  xForwardedFor: string | string[] | undefined,
  remoteAddress: string | undefined,
  trustProxyHops: number,
): string | undefined {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : (xForwardedFor ?? '');
  const chain = raw.split(',').map(normalizeIp).filter(Boolean);
  if (remoteAddress) chain.push(normalizeIp(remoteAddress));
  if (chain.length === 0) return undefined;
  return chain[Math.max(0, chain.length - 1 - Math.max(0, Math.floor(trustProxyHops)))];
}

function withBasePath(basePath: string, p: string): string {
  if (!basePath || p === basePath || p.startsWith(`${basePath}/`)) return p;
  return `${basePath}${p === '/' ? '' : p}` || '/';
}

/** `req.baseUrl` + `req.route.path` handles nested routers on Express 4 and 5. */
function routeTemplateOf(req: Request, basePath: string): string | undefined {
  const routePath: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath !== 'string') return undefined; // unmatched route / regex: server guesses
  const joined = `${req.baseUrl ?? ''}${routePath === '/' ? '' : routePath}` || '/';
  return withBasePath(basePath, joined).slice(0, LIMITS.routeTemplate);
}

function optionalString(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function optionalUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

function optionalBytes(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Runs a user callback; a throwing callback must never break the request. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function defaultClassify(_req: Request, res: Response): 'http' | 'stream' {
  const type = String(res.getHeader('content-type') ?? '');
  const disposition = String(res.getHeader('content-disposition') ?? '');
  return type.includes('text/event-stream') || disposition.startsWith('attachment')
    ? 'stream'
    : 'http';
}

function defaultSkip(req: Request): boolean {
  const p = req.originalUrl.split('?')[0] ?? '';
  return (
    req.method === 'OPTIONS' || SKIP_SUFFIXES.some((s) => p.endsWith(s)) || SKIP_EXTENSIONS.test(p)
  );
}

// ─── Client: queue + batching + retries ─────────────────────────────────────

const noopClient: NexusClient = {
  track: () => undefined,
  flush: async () => undefined,
  shutdown: async () => undefined,
  stats: () => ({ queued: 0, dropped: 0 }),
};

/**
 * Batches events: flush every 5 s or every 100 events, at most 500 per request.
 * Retry rules (guide chapter 4): 202 done · 400/415 drop · 401/403 pause 5 min · 413 split ·
 * 429/503 honour Retry-After · 5xx/network back off 1/2/4 s, max 3 attempts · 3xx/HTML = proxy.
 */
export function createNexusClient(options: NexusClientOptions): NexusClient {
  const {
    url,
    key,
    sdkName = 'nexus-snippet-express-esm',
    sdkVersion = '1.0.0',
    logger = console,
  } = options;
  if (!url || !key) return noopClient;
  const endpoint = `${url.replace(/\/+$/, '')}${SERVER_INGEST_PATH}`;
  const queue: NexusServerEvent[] = [];
  let dropped = 0;
  let pausedUntil = 0;
  let flushing: Promise<void> | null = null;

  const warn = (message: string): void => void safely(() => logger.warn(`[nexus] ${message}`));

  function enqueue(events: NexusServerEvent[], atFront: boolean): void {
    if (atFront) queue.unshift(...events);
    else queue.push(...events);
    while (queue.length > MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
  }

  function post(events: NexusServerEvent[]): Promise<globalThis.Response> {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [KEY_HEADER]: key as string },
      // sentAt is re-stamped on EVERY attempt; events (eventId, occurredAt) are resent unchanged.
      body: JSON.stringify({
        sentAt: new Date().toISOString(),
        sdk: { name: sdkName, version: sdkVersion },
        events,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  function retryAfterMs(res: globalThis.Response): number {
    const seconds = Number(res.headers.get('retry-after'));
    const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_S;
    return Math.min(safe, MAX_RETRY_AFTER_S) * 1_000;
  }

  async function deliver(events: NexusServerEvent[]): Promise<void> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const backoff: number = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] ?? 1_000;
      let res: globalThis.Response;
      try {
        res = await post(events);
      } catch {
        await sleep(backoff); // network error / timeout
        continue;
      }
      const { status } = res;
      const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
      if (status === 202) return; // committed — NEVER retry a 202
      if (status >= 300 && status < 400) {
        return warn(
          `HTTP ${status}: a proxy/SSO is intercepting ${endpoint}; ${events.length} events dropped`,
        );
      }
      if (isHtml)
        return warn(
          `HTML response (${status}): a proxy is intercepting; ${events.length} events dropped`,
        );
      if (status === 413 && events.length > 1) {
        const middle = Math.ceil(events.length / 2);
        await deliver(events.slice(0, middle));
        await deliver(events.slice(middle));
        return;
      }
      if (status === 401 || status === 403) {
        pausedUntil = Date.now() + AUTH_PAUSE_MS;
        enqueue(events, true);
        return warn(`HTTP ${status}: key rejected — pausing 5 minutes (check NEXUS_SECRET_KEY)`);
      }
      if (status === 429 || status === 503) {
        await sleep(retryAfterMs(res));
        continue;
      }
      if (status >= 500) {
        await sleep(backoff);
        continue;
      }
      return warn(
        `HTTP ${status}: batch refused (fix the sender); ${events.length} events dropped`,
      );
    }
    warn(`gave up after ${MAX_ATTEMPTS} attempts; ${events.length} events dropped`);
  }

  async function drain(): Promise<void> {
    while (queue.length > 0 && Date.now() >= pausedUntil) {
      await deliver(queue.splice(0, MAX_EVENTS_PER_REQUEST));
    }
  }

  function flush(): Promise<void> {
    flushing ??= drain()
      .catch(() => undefined)
      .finally(() => {
        flushing = null;
      });
    return flushing;
  }

  const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  timer.unref();

  return {
    track(event) {
      safely(() => {
        enqueue([event], false);
        if (queue.length >= FLUSH_EVERY_EVENTS) void flush();
      });
    },
    flush,
    async shutdown() {
      clearInterval(timer);
      pausedUntil = 0;
      await flush();
    },
    stats: () => ({ queued: queue.length, dropped }),
  };
}

// ─── Middleware ─────────────────────────────────────────────────────────────

/** One server event per request, built when the response finishes (or the client aborts). */
export function nexusMiddleware(options: NexusMiddlewareOptions): RequestHandler {
  const {
    client,
    basePath = '',
    trustProxyHops,
    getUser = () => undefined,
    getErrorCode = (_req, res) => res.locals['errorCode'] as string | undefined,
    skip = defaultSkip,
    classify = defaultClassify,
    release = process.env['NEXUS_RELEASE'],
  } = options;
  if (!Number.isInteger(trustProxyHops))
    throw new Error('nexusMiddleware: set trustProxyHops explicitly');

  function buildEvent(
    req: Request,
    res: Response,
    occurredAt: string,
    startedAt: bigint,
  ): NexusServerEvent {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const errorCode = safely(() => getErrorCode(req, res));
    return {
      eventId: randomUUID(),
      kind: safely(() => classify(req, res)) ?? 'http',
      occurredAt,
      method: req.method,
      path: withBasePath(basePath, req.originalUrl.split('?')[0] ?? '/').slice(0, LIMITS.path),
      routeTemplate: routeTemplateOf(req, basePath),
      status: res.writableFinished ? res.statusCode : 499, // 499 = client closed early
      durationMs: Math.min(Math.round(durationMs * 10) / 10, MAX_DURATION_MS),
      ip: resolveClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxyHops),
      userEmail: optionalString(
        safely(() => getUser(req)),
        LIMITS.email,
      ),
      requestId: optionalString(req.get('x-request-id'), LIMITS.requestId),
      userAgent: optionalString(req.get('user-agent'), LIMITS.userAgent),
      requestBytes: optionalBytes(req.get('content-length')),
      responseBytes: optionalBytes(res.getHeader('content-length')),
      errorCode:
        typeof errorCode === 'string' && ERROR_CODE_PATTERN.test(errorCode) ? errorCode : undefined,
      release: optionalString(release, LIMITS.release),
      sessionId: optionalUuid(req.get('x-nexus-session')),
      pageViewId: optionalUuid(req.get('x-nexus-page-view')),
    };
  }

  return function nexusTraffic(req: Request, res: Response, next: NextFunction): void {
    if (safely(() => skip(req)) ?? true) {
      next();
      return;
    }
    const occurredAt = new Date().toISOString(); // request START
    const startedAt = process.hrtime.bigint();
    let recorded = false;
    const record = (): void => {
      if (recorded) return;
      recorded = true;
      safely(() => client.track(buildEvent(req, res, occurredAt, startedAt)));
    };
    res.once('finish', record);
    res.once('close', record);
    next();
  };
}
