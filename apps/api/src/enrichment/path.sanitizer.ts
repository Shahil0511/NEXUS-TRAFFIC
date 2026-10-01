/**
 * Strips query string and fragment from a wire path and truncates to the stored length.
 */
import { INGEST_LIMITS } from '@nexus/shared';

export interface SanitizedPath {
  path: string;
  truncated: boolean;
}

const QUERY_OR_FRAGMENT = /[?#]/;

/** WHY: query strings carry tokens and PII — they are NEVER stored (CLAUDE.md rule 6). */
export class PathSanitizer {
  sanitize(rawPath: string): SanitizedPath {
    const cut = rawPath.search(QUERY_OR_FRAGMENT);
    const bare = cut === -1 ? rawPath : rawPath.slice(0, cut);
    const rooted = bare.startsWith('/') ? bare : `/${bare}`;
    const max = INGEST_LIMITS.maxStoredPathLength;
    const truncated = rooted.length > max;
    return { path: truncated ? rooted.slice(0, max) : rooted, truncated };
  }
}
