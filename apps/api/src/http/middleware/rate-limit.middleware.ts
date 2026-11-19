/**
 * Ingest rate limits (express-rate-limit, in-memory — single instance).
 * - keyRateLimit: per authenticated app key (after key auth); counts 429s in ingest_counters.
 * - sessionRateLimit: browser only, per (app, envelope sessionId) — one runaway tab cannot use up
 *   the app's whole key budget. Counts 429s in ingest_counters (source 'browser').
 * - ipFailureLimit: per client IP, counting ONLY a 401/403 whose error code is one of
 *   IP_FAILURE_ERROR_CODES: the key guesses (brute-force guard) and ORIGIN_NOT_ALLOWED (a public
 *   publishable key + a forged / missing Origin is refused by originGuard BEFORE the key and session
 *   limiters, and each refusal writes an ingest_rejections row — this is its only bound). The kill
 *   codes (APP_DISABLED, BROWSER_INGEST_DISABLED, SECRET_KEY_EXPOSED) do NOT count: a killed app's
 *   old SDKs behind one office NAT must not 429 every other app from that IP (ADR 0009). Everything
 *   else is un-counted when it finishes, so authenticated traffic is never IP-limited.
 *   IPv6 clients are grouped by /64 (one host usually owns a whole /64, so per-address keys
 *   would be trivially bypassed). express-rate-limit 7.5 has no ipKeyGenerator helper.
 * 429 responses go through RateLimitedError (Retry-After header, standard envelope).
 */
import {
  browserIngestEnvelopeSchema,
  IP_FAILURE_ERROR_CODES,
  type ErrorCode,
  type IngestSource,
} from '@nexus/shared';
import type { Request, RequestHandler, Response } from 'express';
import { rateLimit, type AugmentedRequest } from 'express-rate-limit';

import { ipv6Hextets } from '../../enrichment/ip.anonymizer';
import { RateLimitedError } from '../../errors/app-error';
import { requireIngest, validBody } from '../request-accessors';

/** Both limits count per rolling minute. */
export const RATE_LIMIT_WINDOW_MS = 60_000;

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const UNKNOWN_CLIENT_KEY = 'unknown';
const IPV6_NETWORK_HEXTETS = 4;
const IPV4_MAPPED = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** Seconds until the caller's window resets (≥ 1). */
export function retryAfterSeconds(req: Request, nowMs = Date.now()): number {
  const resetTime = (req as Partial<AugmentedRequest>).rateLimit?.resetTime;
  const remainingMs = resetTime ? resetTime.getTime() - nowMs : RATE_LIMIT_WINDOW_MS;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/** WHY: rate-limit bucket for a client IP — IPv4 as-is, IPv6 by its /64 network. */
export function clientIpKey(ip: string | undefined): string {
  if (!ip) return UNKNOWN_CLIENT_KEY;
  const mappedIpv4 = IPV4_MAPPED.exec(ip);
  if (mappedIpv4?.[1]) return mappedIpv4[1];
  const hextets = ipv6Hextets(ip);
  if (!hextets) return ip;
  const network = hextets.slice(0, IPV6_NETWORK_HEXTETS).map((h) => h.toString(16));
  return `${network.join(':')}::/64`;
}

/** WHY: protects the DB from one runaway sender; keyed by api_keys.id, never by IP. */
export function keyRateLimitMiddleware(
  perMinute: number,
  onLimited: (appId: string, source: IngestSource) => void,
  source: IngestSource,
): RequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // The key comes from auth, not the IP, so the IP/proxy validations do not apply.
    validate: { ip: false, trustProxy: false, xForwardedForHeader: false },
    keyGenerator: (_req, res) => requireIngest(res).key.id,
    handler: (req, res, next) => {
      onLimited(requireIngest(res).app.id, source);
      next(new RateLimitedError(retryAfterSeconds(req)));
    },
  });
}

/** `<app id>:<session id>` — sessions are client-generated, so they are scoped to the app. */
function sessionBucket(res: Response): string {
  const { sessionId } = validBody(res, browserIngestEnvelopeSchema);
  return `${requireIngest(res).app.id}:${sessionId.toLowerCase()}`;
}

/** WHY: per-tab guard on the browser endpoint (runs after publishableKeyAuth and envelope validation). */
export function sessionRateLimitMiddleware(
  perMinute: number,
  onLimited: (appId: string, source: IngestSource) => void,
): RequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: perMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Keyed by app + session, not the IP, so the IP/proxy validations do not apply.
    validate: { ip: false, trustProxy: false, xForwardedForHeader: false },
    keyGenerator: (_req, res) => sessionBucket(res),
    handler: (req, res, next) => {
      onLimited(requireIngest(res).app.id, 'browser');
      next(new RateLimitedError(retryAfterSeconds(req)));
    },
  });
}

/** WHY pure: the "does this count per IP?" rule — status AND the error code set by the error handler. */
export function isCountedIpFailure(statusCode: number, errorCode: ErrorCode | undefined): boolean {
  if (statusCode !== HTTP_UNAUTHORIZED && statusCode !== HTTP_FORBIDDEN) return false;
  return errorCode !== undefined && (IP_FAILURE_ERROR_CODES as readonly ErrorCode[]).includes(errorCode);
}

/** WHY: slows key guessing / origin-forging floods from one client without ever limiting authenticated traffic. */
export function ipFailureLimitMiddleware(perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: perMinute,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => clientIpKey(req.ip),
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => !isCountedIpFailure(res.statusCode, res.locals.errorCode),
    handler: (req, _res, next) => {
      next(new RateLimitedError(retryAfterSeconds(req)));
    },
  });
}
