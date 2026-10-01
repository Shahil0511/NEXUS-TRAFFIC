/**
 * Produces the route template used to group requests into endpoints.
 * Uses the SDK-supplied template when present (scrubbed too); otherwise derives one from the path:
 * uuid → :id, ≥6-digit runs → :num, emails → :email, hex/base64url tokens ≥16 chars → :token.
 * Always starts with '/', ≤ INGEST_LIMITS.maxRouteTemplateLength.
 *
 * Token rule (so readable slugs such as `monthly-report-2024` survive): a segment of ≥16
 * base64url characters containing a digit is a token when it is pure hex, OR it has mixed-case
 * letters, OR it has no `-` / `_` word separators.
 */
import { INGEST_LIMITS } from '@nexus/shared';

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SEGMENT = /^[^@\s/]+@[^@\s/]+\.[^@\s/]+$/;
const ENCODED_AT = /%40/gi;
const HEX_TOKEN = /^[0-9a-f]{16,}$/i;
const BASE64URL_TOKEN = /^[A-Za-z0-9_-]{16,}$/;
const LONG_DIGIT_RUN = /\d{6,}/g;

/** Placeholders written into route templates (also documented in the integration guide). */
export const ROUTE_PLACEHOLDERS = {
  id: ':id',
  num: ':num',
  email: ':email',
  token: ':token',
} as const;

function isToken(segment: string): boolean {
  if (!/\d/.test(segment)) return false;
  if (HEX_TOKEN.test(segment)) return true;
  if (!BASE64URL_TOKEN.test(segment)) return false;
  const mixedCase = /[a-z]/.test(segment) && /[A-Z]/.test(segment);
  return mixedCase || !/[-_]/.test(segment);
}

/** WHY: one high-cardinality segment would otherwise create one "endpoint" per user/order/token. */
export function scrubSegment(segment: string): string {
  if (UUID_SEGMENT.test(segment)) return ROUTE_PLACEHOLDERS.id;
  if (EMAIL_SEGMENT.test(segment.replace(ENCODED_AT, '@'))) return ROUTE_PLACEHOLDERS.email;
  if (isToken(segment)) return ROUTE_PLACEHOLDERS.token;
  return segment.replace(LONG_DIGIT_RUN, ROUTE_PLACEHOLDERS.num);
}

/** WHY: endpoint grouping key (also hashed into endpoint_id) — must be stable and low-cardinality. */
export class RouteNormalizer {
  normalize(path: string, suppliedTemplate?: string): string {
    const source = suppliedTemplate?.startsWith('/') ? suppliedTemplate : path;
    const scrubbed = source.split('/').map(scrubSegment).join('/');
    const rooted = scrubbed.startsWith('/') ? scrubbed : `/${scrubbed}`;
    return rooted.slice(0, INGEST_LIMITS.maxRouteTemplateLength);
  }
}
