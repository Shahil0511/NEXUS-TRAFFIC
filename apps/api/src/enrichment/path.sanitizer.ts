/**
 * Strips query string and fragment from a wire path and truncates to the stored length.
 */
import { notImplemented } from '../lib/not-implemented';

export interface SanitizedPath {
  path: string;
  truncated: boolean;
}

export class PathSanitizer {
  sanitize(rawPath: string): SanitizedPath {
    void rawPath;
    throw notImplemented('PathSanitizer.sanitize');
  }
}
