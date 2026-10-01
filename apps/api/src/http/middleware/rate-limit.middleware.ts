/**
 * Ingest rate limits (express-rate-limit, in-memory — single instance).
 * - keyRateLimit: per authenticated app key (after key auth); counts 429s in ingest_counters.
 * - ipFailureLimit: per client IP, counting ONLY failed key authentications (401/403 responses —
 *   brute-force guard). Successful requests are un-counted when they finish, so authenticated
 *   traffic is never IP-limited (many apps/users share NAT/gateway IPs).
 *   IPv6 clients are grouped by /64 (one host usually owns a whole /64, so per-address keys
 *   would be trivially bypassed). express-rate-limit 7.5 has no ipKeyGenerator helper.
 * 429 responses go through RateLimitedError (Retry-After header, standard envelope).
 */
import type { IngestSource } from '@nexus/shared';
import type { Request, RequestHandler } from 'express';
import { rateLimit, type AugmentedRequest } from 'express-rate-limit';

import { ipv6Hextets } from '../../enrichment/ip.anonymizer';
import { RateLimitedError } from '../../errors/app-error';
import { requireIngest } from '../request-accessors';

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

/** WHY: slows key guessing from one client without ever limiting authenticated traffic. */
export function ipFailureLimitMiddleware(perMinute: number): RequestHandler {
  return rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    limit: perMinute,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) => clientIpKey(req.ip),
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) =>
      res.statusCode !== HTTP_UNAUTHORIZED && res.statusCode !== HTTP_FORBIDDEN,
    handler: (req, _res, next) => {
      next(new RateLimitedError(retryAfterSeconds(req)));
    },
  });
}
