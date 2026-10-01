/**
 * Pure parsing of a raw API key string into its kind and lookup prefix. No I/O.
 */
import type { KeyKind } from '@nexus/shared';

import { notImplemented } from '../lib/not-implemented';

export interface ParsedApiKey {
  kind: KeyKind;
  /** First KEY_LOOKUP_PREFIX_LENGTH chars — the indexed lookup value. */
  keyPrefix: string;
}

/** Returns null when `raw` does not match API_KEY_PATTERN. */
export function parseApiKey(raw: string | undefined | null): ParsedApiKey | null {
  void raw;
  throw notImplemented('parseApiKey');
}
