/**
 * Path helpers.
 *
 * WHY: the contract wants `path` and `routeTemplate` as the PUBLIC path (base path included, no
 * query), whether or not the gateway strips the base path before Express sees it.
 */

/** Drop `?query` and `#fragment` — query strings are NEVER sent (PII). */
export function stripQuery(url: string): string {
  const end = url.search(/[?#]/);
  const path = end === -1 ? url : url.slice(0, end);
  return path === '' ? '/' : path;
}

/** '/ebo-sales/' → '/ebo-sales', 'ebo-sales' → '/ebo-sales', '/' or '' → ''. */
export function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = (basePath ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Join path segments with exactly one slash between them; never returns ''. */
export function joinPath(...parts: Array<string | undefined>): string {
  const joined = parts
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');
  return `/${joined}`;
}

/** Prefix the base path unless the path already starts with it (gateway did not strip it). */
export function withBasePath(basePath: string, path: string): string {
  if (basePath === '' || path === basePath || path.startsWith(`${basePath}/`)) return path;
  return joinPath(basePath, path);
}
