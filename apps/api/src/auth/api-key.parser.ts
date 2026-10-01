/**
 * Pure parsing of a raw API key string into its kind and lookup prefix. No I/O.
 *
 * WHY separate: the authenticator orchestrates; this function only answers "is this string shaped
 * like one of our keys, and which row would it be?" — trivially unit-testable.
 */
import {
  API_KEY_PATTERN,
  KEY_KIND_VALUES,
  KEY_LOOKUP_PREFIX_LENGTH,
  KEY_PREFIXES,
  type KeyKind,
} from '@nexus/shared';

export interface ParsedApiKey {
  kind: KeyKind;
  /** First KEY_LOOKUP_PREFIX_LENGTH chars — the indexed lookup value. */
  keyPrefix: string;
}

/** WHY: single strict gate for key shape. Returns null when `raw` does not match API_KEY_PATTERN. */
export function parseApiKey(raw: string | undefined | null): ParsedApiKey | null {
  if (typeof raw !== 'string' || !API_KEY_PATTERN.test(raw)) return null;
  const kind = KEY_KIND_VALUES.find((candidate) => raw.startsWith(KEY_PREFIXES[candidate]));
  if (!kind) return null;
  return { kind, keyPrefix: raw.slice(0, KEY_LOOKUP_PREFIX_LENGTH) };
}
