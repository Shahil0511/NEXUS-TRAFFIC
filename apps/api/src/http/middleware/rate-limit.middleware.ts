/**
 * Ingest rate limits (express-rate-limit, in-memory — single instance).
 * - keyRateLimit: per authenticated app key (after key auth); counts 429s in ingest_counters.
 * - ipFailureLimit: per client IP, counting ONLY failed key authentications (brute-force guard).
 *   Authenticated traffic is never IP-limited (many apps/users share NAT/gateway IPs).
 * 429 responses go through RateLimitedError (Retry-After header, standard envelope).
 */
import type { IngestSource } from '@nexus/shared';
import type { RequestHandler } from 'express';

import { notImplemented } from '../../lib/not-implemented';

export function keyRateLimitMiddleware(
  perMinute: number,
  onLimited: (appId: string, source: IngestSource) => void,
  source: IngestSource,
): RequestHandler {
  void perMinute;
  void onLimited;
  void source;
  return () => {
    throw notImplemented('keyRateLimitMiddleware');
  };
}

export function ipFailureLimitMiddleware(perMinute: number): RequestHandler {
  void perMinute;
  return () => {
    throw notImplemented('ipFailureLimitMiddleware');
  };
}
