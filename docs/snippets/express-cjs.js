'use strict';
/**
 * Data Nexus Traffic — reference Express middleware (plain JavaScript, CommonJS).
 *
 * Copy this file into your backend (e.g. `src/nexus.js`). Node >= 18 (global fetch), Express 4 or 5,
 * ZERO dependencies. It records one event per API request and sends them in batches.
 * It NEVER throws into your app and NEVER blocks a response: if Nexus is down, events are dropped.
 *
 *   const { createNexusClient, nexusMiddleware } = require('./nexus');
 *   const nexus = createNexusClient({
 *     url: process.env.NEXUS_URL,             // https://nexus.libas.in/traffic (unset → no-op)
 *     key: process.env.NEXUS_SECRET_KEY,      // nx_sk_… (server env ONLY)
 *   });
 *   app.use(nexusMiddleware({
 *     client: nexus,
 *     basePath: '/my-app',                    // public prefix your gateway strips ('' if none)
 *     trustProxyHops: 1,                      // gateway → app = 1; gateway → Next → app = 2
 *     getUser: (req) => req.user?.email,      // your VERIFIED user, read when the response ends
 *   }));
 *   // in your existing shutdown handler:  await nexus.shutdown();
 *
 * Contract: https://nexus.libas.in/traffic/api/docs/
 */
const { randomUUID } = require('node:crypto');

// ─── Contract constants (v1) ────────────────────────────────────────────────
const SERVER_INGEST_PATH = '/api/v1/ingest/server';
const KEY_HEADER = 'X-Nexus-Key';
const MAX_EVENTS_PER_REQUEST = 500;
const LIMITS = { path: 2048, routeTemplate: 256, email: 254, userAgent: 4096, requestId: 128 };
const MAX_DURATION_MS = 3600000;
const ERROR_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ─── Batching / retry defaults ──────────────────────────────────────────────
const FLUSH_EVERY_EVENTS = 100;
const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 5000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 2000, 4000];
const AUTH_PAUSE_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_AFTER_S = 5;
const MAX_RETRY_AFTER_S = 60;

const SKIP_SUFFIXES = ['/health', '/healthz', '/ready', '/live', '/metrics', '/favicon.ico'];
const SKIP_EXTENSIONS = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf)$/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** setTimeout that never keeps the process alive. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/** Strip the IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4). */
function normalizeIp(value) {
  const v = String(value).trim();
  return v.toLowerCase().startsWith('::ffff:') && v.includes('.') ? v.slice(7) : v;
}

/**
 * The end-user IP, walking X-Forwarded-For from the RIGHT by the number of proxies YOU run.
 * NEVER take the leftmost entry: the client can write anything there.
 */
function resolveClientIp(xForwardedFor, remoteAddress, trustProxyHops) {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : xForwardedFor || '';
  const chain = raw.split(',').map(normalizeIp).filter(Boolean);
  if (remoteAddress) chain.push(normalizeIp(remoteAddress));
  if (chain.length === 0) return undefined;
  const index = Math.max(0, chain.length - 1 - Math.max(0, Math.floor(trustProxyHops)));
  return chain[index];
}

/** Prefix the public base path unless the app already sees it. */
function withBasePath(basePath, p) {
  if (!basePath || p === basePath || p.startsWith(`${basePath}/`)) return p;
  return `${basePath}${p === '/' ? '' : p}` || '/';
}

/** `/api` + `/stores/:id` → `/api/stores/:id` (Express 4 and 5, nested routers included). */
function routeTemplateOf(req, basePath) {
  const routePath = req.route && req.route.path;
  if (typeof routePath !== 'string') return undefined; // unmatched route / regex: server guesses
  const joined = `${req.baseUrl || ''}${routePath === '/' ? '' : routePath}` || '/';
  return withBasePath(basePath, joined).slice(0, LIMITS.routeTemplate);
}

function optionalString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
}

function optionalUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : undefined;
}

function optionalBytes(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Codes only (e.g. VALIDATION_ERROR) — NEVER an error message. */
function errorCodeOf(getErrorCode, req, res) {
  try {
    const code = getErrorCode(req, res);
    return typeof code === 'string' && ERROR_CODE_PATTERN.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

/** `stream` = SSE / downloads / exports: kept out of latency percentiles. */
function defaultClassify(_req, res) {
  const type = String(res.getHeader('content-type') || '');
  const disposition = String(res.getHeader('content-disposition') || '');
  return type.includes('text/event-stream') || disposition.startsWith('attachment')
    ? 'stream'
    : 'http';
}

function defaultSkip(req) {
  const p = req.originalUrl.split('?')[0];
  return (
    req.method === 'OPTIONS' || SKIP_SUFFIXES.some((s) => p.endsWith(s)) || SKIP_EXTENSIONS.test(p)
  );
}

// ─── Client: queue + batching + retries ─────────────────────────────────────

function createNoopClient() {
  return {
    track() {},
    async flush() {},
    async shutdown() {},
    stats: () => ({ queued: 0, dropped: 0 }),
  };
}

/**
 * Batches events: flush every 5 s or every 100 events, at most 500 per request.
 * Retry rules (guide chapter 4): 202 done · 400/415 drop · 401/403 pause 5 min · 413 split ·
 * 429/503 honour Retry-After · 5xx/network back off 1/2/4 s, max 3 attempts · 3xx/HTML = proxy.
 */
function createNexusClient(options) {
  const {
    url,
    key,
    sdkName = 'nexus-snippet-express-cjs',
    sdkVersion = '1.0.0',
    logger = console,
  } = options || {};
  if (!url || !key) return createNoopClient();
  const endpoint = `${String(url).replace(/\/+$/, '')}${SERVER_INGEST_PATH}`;
  const queue = [];
  let dropped = 0;
  let pausedUntil = 0;
  let flushing = null;

  const warn = (message) => {
    try {
      logger.warn(`[nexus] ${message}`);
    } catch {
      /* never throw */
    }
  };

  function enqueue(events, atFront) {
    if (atFront) queue.unshift(...events);
    else queue.push(...events);
    while (queue.length > MAX_QUEUE) {
      queue.shift();
      dropped += 1;
    }
  }

  async function post(events) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [KEY_HEADER]: key },
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

  function retryAfterMs(res) {
    const seconds = Number(res.headers.get('retry-after'));
    const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : DEFAULT_RETRY_AFTER_S;
    return Math.min(safe, MAX_RETRY_AFTER_S) * 1000;
  }

  async function deliver(events) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let res;
      try {
        res = await post(events);
      } catch {
        await sleep(BACKOFF_MS[attempt]); // network error / timeout
        continue;
      }
      const status = res.status;
      const isHtml = String(res.headers.get('content-type') || '').includes('text/html');
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
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      return warn(
        `HTTP ${status}: batch refused (fix the sender); ${events.length} events dropped`,
      );
    }
    warn(`gave up after ${MAX_ATTEMPTS} attempts; ${events.length} events dropped`);
  }

  async function drain() {
    while (queue.length > 0 && Date.now() >= pausedUntil) {
      await deliver(queue.splice(0, MAX_EVENTS_PER_REQUEST));
    }
  }

  function flush() {
    if (!flushing) {
      flushing = drain()
        .catch(() => undefined)
        .finally(() => {
          flushing = null;
        });
    }
    return flushing;
  }

  const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  timer.unref();

  return {
    track(event) {
      try {
        enqueue([event], false);
        if (queue.length >= FLUSH_EVERY_EVENTS) void flush();
      } catch {
        /* never throw into the app */
      }
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
function nexusMiddleware(options) {
  const {
    client,
    basePath = '',
    trustProxyHops,
    getUser = () => undefined,
    getErrorCode = (_req, res) => res.locals && res.locals.errorCode, // your app's error CODE
    skip = defaultSkip,
    classify = defaultClassify,
    release = process.env.NEXUS_RELEASE,
  } = options;
  if (!Number.isInteger(trustProxyHops))
    throw new Error('nexusMiddleware: set trustProxyHops explicitly');

  return function nexusTraffic(req, res, next) {
    let skipThis = false;
    try {
      skipThis = skip(req);
    } catch {
      skipThis = true;
    }
    if (skipThis) return next();

    const occurredAt = new Date().toISOString(); // request START
    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const record = () => {
      if (recorded) return;
      recorded = true;
      try {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        let userEmail;
        try {
          userEmail = optionalString(getUser(req), LIMITS.email);
        } catch {
          userEmail = undefined;
        }
        client.track({
          eventId: randomUUID(),
          kind: classify(req, res),
          occurredAt,
          method: req.method,
          path: withBasePath(basePath, req.originalUrl.split('?')[0]).slice(0, LIMITS.path),
          routeTemplate: routeTemplateOf(req, basePath),
          status: res.writableFinished ? res.statusCode : 499, // 499 = client closed early
          durationMs: Math.min(Math.round(durationMs * 10) / 10, MAX_DURATION_MS),
          ip: resolveClientIp(
            req.headers['x-forwarded-for'],
            req.socket.remoteAddress,
            trustProxyHops,
          ),
          userEmail,
          requestId: optionalString(req.get('x-request-id'), LIMITS.requestId),
          userAgent: optionalString(req.get('user-agent'), LIMITS.userAgent),
          requestBytes: optionalBytes(req.get('content-length')),
          responseBytes: optionalBytes(res.getHeader('content-length')),
          errorCode: errorCodeOf(getErrorCode, req, res),
          release: optionalString(release, 64),
          sessionId: optionalUuid(req.get('x-nexus-session')),
          pageViewId: optionalUuid(req.get('x-nexus-page-view')),
        });
      } catch {
        /* never throw into the app */
      }
    };

    res.once('finish', record);
    res.once('close', record);
    next();
  };
}

module.exports = { createNexusClient, nexusMiddleware, resolveClientIp };
