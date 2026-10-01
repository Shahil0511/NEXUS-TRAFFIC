/**
 * Produces the route template used to group requests into endpoints.
 * Uses the SDK-supplied template when present (scrubbed too); otherwise derives one from the path:
 * uuid → :id, ≥6-digit runs → :num, emails → :email, hex/base64url tokens ≥16 chars → :token.
 * Always starts with '/', ≤ INGEST_LIMITS.maxRouteTemplateLength.
 */
import { notImplemented } from '../lib/not-implemented';

export class RouteNormalizer {
  normalize(path: string, suppliedTemplate?: string): string {
    void path;
    void suppliedTemplate;
    throw notImplemented('RouteNormalizer.normalize');
  }
}
