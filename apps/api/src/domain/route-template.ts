/**
 * Server-side plausibility guard of an SDK-supplied browser `routeTemplate` (A1). Pure, no I/O.
 *
 * WHY: the template decides `toPageId`, so a wrong one (stale router state, a template of another
 * page) would silently merge unrelated pages. BrowserEventEnricher keeps the template ONLY when it
 * fits the path; otherwise it drops it (FIELD_DROPPED `routeTemplate`) and the server guesses from
 * the path, exactly as for an SDK that sends no template.
 *
 * Placeholder syntax (ADR 0013 / docs): `:name` matches one segment; a LAST segment `:name*` is a
 * catch-all matching the rest (zero or more segments).
 */
import { isWithinBasePath } from './base-path';

const PLACEHOLDER_PREFIX = ':';
const CATCH_ALL_SUFFIX = '*';

function segmentsOf(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '');
}

function isPlaceholder(segment: string): boolean {
  return segment.startsWith(PLACEHOLDER_PREFIX) && segment.length > 1;
}

function isCatchAll(segment: string | undefined): boolean {
  return segment !== undefined && isPlaceholder(segment) && segment.endsWith(CATCH_ALL_SUFFIX);
}

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Static segments compare case-insensitively (raw or percent-decoded). */
function staticMatches(templateSegment: string, pathSegment: string | undefined): boolean {
  if (pathSegment === undefined) return false;
  const wanted = templateSegment.toLowerCase();
  return wanted === pathSegment.toLowerCase() || wanted === decoded(pathSegment).toLowerCase();
}

/**
 * WHY: keep a template only if (1) it is within the app's base path, (2) it has as many segments as
 * the path — or, with a trailing catch-all, at most one more — and (3) every static segment equals
 * the path segment at the same position (case-insensitive), up to the catch-all.
 */
export function isPlausibleRouteTemplate(template: string, path: string, basePath: string | null): boolean {
  if (!isWithinBasePath(template, basePath)) return false;
  const templateSegments = segmentsOf(template);
  const pathSegments = segmentsOf(path);
  const catchAll = isCatchAll(templateSegments[templateSegments.length - 1]);
  const fixed = catchAll ? templateSegments.slice(0, -1) : templateSegments;
  if (catchAll ? fixed.length > pathSegments.length : fixed.length !== pathSegments.length) return false;
  return fixed.every((segment, i) => isPlaceholder(segment) || staticMatches(segment, pathSegments[i]));
}
