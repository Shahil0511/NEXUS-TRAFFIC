/**
 * The base-path rule of browser ingest: a beacon may only report pages of ITS app, i.e. paths
 * under `apps.base_path` (PATH_OUTSIDE_APP otherwise). Pure, no I/O.
 */

/** Characters that may follow the base path: a new segment, a query or a fragment. */
const SEGMENT_BOUNDARIES = ['/', '?', '#'];

/**
 * WHY segment-aware: `/ebo-sales-admin` must NOT pass for base path `/ebo-sales`.
 * A null base path (or `/`) means the app owns the whole origin.
 */
export function isWithinBasePath(path: string, basePath: string | null): boolean {
  const base = basePath?.replace(/\/+$/, '') ?? '';
  if (base === '') return true;
  if (!path.startsWith(base)) return false;
  const next = path.charAt(base.length);
  return next === '' || SEGMENT_BOUNDARIES.includes(next);
}
