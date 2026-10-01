import {
  DEFAULT_SKIP_EXTENSIONS,
  DEFAULT_SKIP_PATH_SUFFIXES,
  HTTP_METHOD_VALUES,
} from '@nexus/shared/constants';

import { stripQuery } from './path';
import type { NexusRequestLike } from './types';

const FRAMEWORK_ASSET_SEGMENTS = ['/_next/', '/assets/'] as const;
const KNOWN_METHODS: ReadonlySet<string> = new Set(HTTP_METHOD_VALUES);

/** The request path as Express saw it, without the query. */
export function requestPath(req: NexusRequestLike): string {
  return stripQuery(req.originalUrl ?? req.url ?? '/');
}

/**
 * WHY: CORS preflights, health probes and static files are noise that would drown real API
 * traffic (and cost rate limit). This is the documented default; `skip` replaces it.
 */
export function defaultSkip(req: NexusRequestLike): boolean {
  if (req.method.toUpperCase() === 'OPTIONS') return true;
  const path = requestPath(req).toLowerCase();
  return (
    DEFAULT_SKIP_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix)) ||
    DEFAULT_SKIP_EXTENSIONS.some((extension) => path.endsWith(extension)) ||
    FRAMEWORK_ASSET_SEGMENTS.some((segment) => path.includes(segment))
  );
}

/** WHY: the server rejects methods outside the contract enum — not worth sending. */
export function isContractMethod(method: string): boolean {
  return KNOWN_METHODS.has(method.toUpperCase());
}
