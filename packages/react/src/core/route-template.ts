/**
 * Route templates on the wire (A1): `/my-app/stores/:id` instead of a guessed one.
 *
 * WHY: the collector groups page views by template. Guessing (numbers, uuids) cannot know that
 * `/stores/delhi-saket` is one store among many; the router can. When unsure, NO template is
 * sent — the server then falls back to guessing, which is never worse than today.
 */
import { INGEST_LIMITS } from '@nexus/shared/constants';

/** WHY: same hygiene as a wire path; `undefined` when it cannot be a valid template. */
export function toWireRouteTemplate(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const withoutQuery = (value.split(/[?#]/, 1)[0] ?? '').trim();
  if (!withoutQuery) return undefined;
  const absolute = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return absolute.length > INGEST_LIMITS.maxRouteTemplateLength ? undefined : absolute;
}

export type NextParams = Record<string, string | string[] | undefined>;

/**
 * Next App Router: rebuild the template from `usePathname()` and `useParams()`.
 * - A segment whose (decoded) value equals a scalar param becomes `:name`.
 * - A run of segments equal to an array param (catch-all) becomes `:name*`.
 * - A value that is not found exactly once (missing, duplicated, overlapping) → `undefined`.
 * - `params === null` (outside the App Router) → `undefined`.
 * It runs during render, so it is wrapped ENTIRELY: any throw (a throwing getter, a bad
 * percent-encoding) → `undefined`. NEVER throws.
 */
export function nextRouteTemplate(pathname: string, params: NextParams | null): string | undefined {
  try {
    if (typeof pathname !== 'string' || !params || typeof params !== 'object') return undefined;
    const segments = pathname.split('/').filter((s) => s !== '');
    const decoded = segments.map(safeDecode);
    const replaced: Array<string | null> = segments.slice();
    const claimed = new Array<boolean>(segments.length).fill(false);

    for (const [name, value] of Object.entries(params)) {
      if (value === undefined) continue; // optional catch-all with no segments
      const run = Array.isArray(value) ? value : [value];
      if (run.length === 0) continue;
      const at = findOnce(segments, decoded, run);
      if (at === undefined) return undefined;
      for (let i = at; i < at + run.length; i++) {
        if (claimed[i]) return undefined;
        claimed[i] = true;
        replaced[i] = null;
      }
      replaced[at] = Array.isArray(value) ? `:${name}*` : `:${name}`;
    }
    const out = replaced.filter((s): s is string => s !== null);
    return `/${out.join('/')}`;
  } catch {
    return undefined;
  }
}

/** WHY: the start index of the ONE place `run` occurs (raw or decoded), else undefined. */
function findOnce(raw: string[], decoded: string[], run: string[]): number | undefined {
  let found: number | undefined;
  for (let start = 0; start + run.length <= raw.length; start++) {
    const matches = run.every((value, k) => raw[start + k] === value || decoded[start + k] === value);
    if (!matches) continue;
    if (found !== undefined) return undefined;
    found = start;
  }
  return found;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
