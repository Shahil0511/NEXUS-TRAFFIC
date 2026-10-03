/**
 * Which browser origins may open a Socket.io connection (engine.io `allowRequest`).
 *
 * WHY: websockets are not covered by CORS — any page the user visits could open one with the
 * user's SSO cookie (cross-site WebSocket hijacking). The rule (ADR 0001 "Realtime"):
 * - a MISSING Origin is allowed (same-origin polling through nginx, non-browser clients — they
 *   still need a valid SSO cookie);
 * - `Origin: null` (sandboxed iframes, file://) is REJECTED;
 * - any other Origin must be the dashboard's PUBLIC_ORIGIN (or, outside production, one of
 *   CORS_DEV_ORIGINS).
 */
import type { IncomingMessage } from 'node:http';

import type { AppConfig } from '../config';

/** The literal Origin value browsers send for opaque origins. */
const OPAQUE_ORIGIN = 'null';

/** Pure decision (unit-tested). `allowed` holds normalised origins (`new URL(x).origin`). */
export function isAllowedSocketOrigin(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  if (origin === undefined) return true;
  if (origin === OPAQUE_ORIGIN) return false;
  return allowed.has(origin);
}

/** `scheme://host[:port]` of a configured origin; unparsable entries are dropped. */
function normaliseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** PUBLIC_ORIGIN, plus CORS_DEV_ORIGINS outside production. */
export function allowedSocketOrigins(config: AppConfig): Set<string> {
  const candidates = [
    config.env.PUBLIC_ORIGIN,
    ...(config.isProduction ? [] : config.corsDevOrigins),
  ];
  return new Set(candidates.map(normaliseOrigin).filter((o): o is string => o !== null));
}

type AllowRequest = (
  req: IncomingMessage,
  callback: (err: string | null | undefined, success: boolean) => void,
) => void;

/** engine.io `allowRequest` hook enforcing isAllowedSocketOrigin. */
export function createAllowRequest(allowed: ReadonlySet<string>): AllowRequest {
  return (req, callback) => {
    const ok = isAllowedSocketOrigin(req.headers.origin, allowed);
    callback(ok ? null : 'origin not allowed', ok);
  };
}
