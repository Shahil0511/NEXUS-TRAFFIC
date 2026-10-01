/**
 * "Send sample traffic": realistic, varied server events for `demo-app`, POSTed to the real ingest
 * route with the demo secret key.
 *
 * WHY: the dashboard is only worth looking at with data in it. The generator is PURE (injectable
 * clock + random source) so a unit test can prove every batch satisfies the public contract
 * (`serverIngestBatchSchema`), and the sender goes through ROUTES.ingest.server exactly like an
 * integrated app would.
 */
import { randomUUID } from 'node:crypto';

import {
  INGEST_HEADERS,
  INGEST_LIMITS,
  ROUTES,
  serverIngestBatchSchema,
  type IngestResultDto,
  type ServerEventInput,
  type ServerIngestBatchInput,
} from '@nexus/shared';

import { parseJsonOrNull } from './dashboard-api';
import { apiUrl } from './topology';

/** Events are spread over this window, ending now (well inside the 7-day backdate policy). */
export const SAMPLE_WINDOW_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_SAMPLE_COUNT = 200;
export const MAX_SAMPLE_COUNT = 5000;

const SDK = { name: 'nexus-dev-launcher', version: '1.0.0' } as const;

interface RouteProfile {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  template: string;
  /** Builds a concrete path from the template. */
  fill: (rnd: () => number) => string;
  /** Median duration in ms (log-normal). */
  medianMs: number;
  /** Relative frequency. */
  weight: number;
  okStatus: number;
}

const id = (rnd: () => number, max: number): string => String(1 + Math.floor(rnd() * max));

const ROUTE_PROFILES: readonly RouteProfile[] = [
  { method: 'GET', template: '/demo/api/products', fill: () => '/demo/api/products', medianMs: 45, weight: 30, okStatus: 200 },
  { method: 'GET', template: '/demo/api/products/:id', fill: (r) => `/demo/api/products/${id(r, 500)}`, medianMs: 30, weight: 22, okStatus: 200 },
  { method: 'POST', template: '/demo/api/orders', fill: () => '/demo/api/orders', medianMs: 180, weight: 10, okStatus: 201 },
  { method: 'GET', template: '/demo/api/orders/:id', fill: (r) => `/demo/api/orders/${id(r, 9000)}`, medianMs: 60, weight: 10, okStatus: 200 },
  { method: 'GET', template: '/demo/api/stores/:storeId/stock', fill: (r) => `/demo/api/stores/${id(r, 40)}/stock`, medianMs: 120, weight: 12, okStatus: 200 },
  { method: 'PATCH', template: '/demo/api/cart/items/:itemId', fill: (r) => `/demo/api/cart/items/${id(r, 300)}`, medianMs: 70, weight: 6, okStatus: 200 },
  { method: 'DELETE', template: '/demo/api/cart/items/:itemId', fill: (r) => `/demo/api/cart/items/${id(r, 300)}`, medianMs: 40, weight: 4, okStatus: 204 },
  { method: 'POST', template: '/demo/api/auth/refresh', fill: () => '/demo/api/auth/refresh', medianMs: 25, weight: 4, okStatus: 200 },
  { method: 'GET', template: '/demo/api/reports/daily', fill: () => '/demo/api/reports/daily', medianMs: 900, weight: 2, okStatus: 200 },
];

const CLIENT_ERRORS: ReadonlyArray<{ status: number; code: string }> = [
  { status: 400, code: 'VALIDATION_ERROR' },
  { status: 401, code: 'UNAUTHORIZED' },
  { status: 404, code: 'NOT_FOUND' },
  { status: 422, code: 'UNPROCESSABLE' },
];

const SERVER_ERRORS: ReadonlyArray<{ status: number; code: string }> = [
  { status: 500, code: 'INTERNAL_ERROR' },
  { status: 502, code: 'UPSTREAM_ERROR' },
  { status: 503, code: 'SERVICE_UNAVAILABLE' },
];

const USERS = ['asha.k@libas.in', 'rohit.m@libas.in', 'neha.s@libas.in', 'vikram.p@libas.in', 'store.ops@libas.in'];

/** Public IPs with known geo (Google DNS, Cloudflare, an Indian ISP range). */
const IPS = ['8.8.8.8', '1.1.1.1', '49.36.0.1', '103.21.244.1', '49.37.12.7'];

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
];

function pick<T>(items: readonly T[], rnd: () => number): T {
  return items[Math.floor(rnd() * items.length)] as T;
}

function pickWeighted(profiles: readonly RouteProfile[], rnd: () => number): RouteProfile {
  const total = profiles.reduce((sum, p) => sum + p.weight, 0);
  let roll = rnd() * total;
  for (const profile of profiles) {
    roll -= profile.weight;
    if (roll < 0) return profile;
  }
  return profiles[profiles.length - 1] as RouteProfile;
}

/** Standard normal via Box–Muller. */
function normal(rnd: () => number): number {
  const u = Math.max(rnd(), Number.EPSILON);
  const v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal duration around `medianMs` (long right tail), clamped to the contract limit. */
function durationMs(medianMs: number, rnd: () => number): number {
  const value = Math.exp(Math.log(medianMs) + 0.6 * normal(rnd));
  return Math.min(INGEST_LIMITS.maxDurationMs, Math.round(value * 10) / 10);
}

/** ~88 % success, ~8 % client errors, ~4 % server errors. */
function outcome(profile: RouteProfile, rnd: () => number): { status: number; errorCode?: string } {
  const roll = rnd();
  if (roll < 0.04) {
    const err = pick(SERVER_ERRORS, rnd);
    return { status: err.status, errorCode: err.code };
  }
  if (roll < 0.12) {
    const err = pick(CLIENT_ERRORS, rnd);
    return { status: err.status, errorCode: err.code };
  }
  return { status: profile.okStatus };
}

export interface GenerateOptions {
  count: number;
  nowMs?: number;
  random?: () => number;
  uuid?: () => string;
}

/** `count` server events with occurredAt inside the last SAMPLE_WINDOW_MS. */
export function generateServerEvents(options: GenerateOptions): ServerEventInput[] {
  const rnd = options.random ?? Math.random;
  const uuid = options.uuid ?? randomUUID;
  const now = options.nowMs ?? Date.now();
  const events: ServerEventInput[] = [];
  for (let i = 0; i < options.count; i += 1) {
    const profile = pickWeighted(ROUTE_PROFILES, rnd);
    const result = outcome(profile, rnd);
    const signedIn = rnd() < 0.7;
    // At least 1 s in the past so a slow clock never produces a "future" event.
    const occurredAt = new Date(now - 1000 - Math.floor(rnd() * (SAMPLE_WINDOW_MS - 1000))).toISOString();
    events.push({
      eventId: uuid(),
      kind: 'http',
      occurredAt,
      method: profile.method,
      path: profile.fill(rnd),
      routeTemplate: profile.template,
      status: result.status,
      durationMs: durationMs(result.status >= 500 ? profile.medianMs * 3 : profile.medianMs, rnd),
      ip: pick(IPS, rnd),
      userAgent: pick(USER_AGENTS, rnd),
      requestId: uuid(),
      ...(signedIn ? { userEmail: pick(USERS, rnd) } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      release: 'dev-demo',
    });
  }
  return events;
}

/** Splits events into contract-valid batches (≤ INGEST_LIMITS.server.maxEvents each). Throws if one is invalid. */
export function toValidatedBatches(events: readonly ServerEventInput[], nowMs: number = Date.now()): ServerIngestBatchInput[] {
  const size = INGEST_LIMITS.server.maxEvents;
  const batches: ServerIngestBatchInput[] = [];
  for (let start = 0; start < events.length; start += size) {
    const batch: ServerIngestBatchInput = {
      sentAt: new Date(nowMs).toISOString(),
      sdk: { ...SDK },
      events: events.slice(start, start + size),
    };
    serverIngestBatchSchema.parse(batch);
    batches.push(batch);
  }
  return batches;
}

export interface TrafficResult {
  sent: number;
  batches: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  warnings: number;
  /** First few rejection codes, for the page. */
  rejectionCodes: string[];
}

/** Clamps the page's count input to 1…MAX_SAMPLE_COUNT. */
export function clampSampleCount(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SAMPLE_COUNT;
  return Math.min(n, MAX_SAMPLE_COUNT);
}

/** Generates `count` events and POSTs them to ROUTES.ingest.server with the secret key. */
export async function sendSampleTraffic(secretKey: string, count: number): Promise<TrafficResult> {
  const batches = toValidatedBatches(generateServerEvents({ count }));
  const total: TrafficResult = { sent: count, batches: batches.length, accepted: 0, duplicates: 0, rejected: 0, warnings: 0, rejectionCodes: [] };
  for (const batch of batches) {
    const res = await fetch(apiUrl(ROUTES.ingest.server), {
      method: ROUTES.ingest.server.method,
      headers: { 'Content-Type': 'application/json', [INGEST_HEADERS.key]: secretKey },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(20_000),
    });
    const body = parseJsonOrNull(await res.text()) as (IngestResultDto & { error?: { code?: string; message?: string } }) | null;
    if (res.status !== 202 || !body) {
      throw new Error(`ingest answered ${res.status}${body?.error?.code ? ` ${body.error.code}` : ''}`);
    }
    total.accepted += body.accepted;
    total.duplicates += body.duplicates;
    total.rejected += body.rejected.length;
    total.warnings += body.warnings.length;
    for (const r of body.rejected) {
      if (total.rejectionCodes.length < 5 && !total.rejectionCodes.includes(r.code)) total.rejectionCodes.push(r.code);
    }
  }
  return total;
}
