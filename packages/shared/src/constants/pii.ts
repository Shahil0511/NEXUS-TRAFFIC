/**
 * PII detector rules of the ingest enrichment (ADR 0010).
 *
 * WHY THIS FILE EXISTS
 * Senders sometimes put personal data where it does not belong: an email in a path, a mobile number
 * in a button label, a PAN in a prop value. The API's `PiiScrubber` REPLACES such matches (it never
 * rejects the event), reports a FIELD_REDACTED warning and counts the detection in
 * `traffic.pii_detections` (0011). The kinds and fields here are mirrored by that table's CHECKs.
 * The matched value is NEVER stored or logged.
 *
 * Patterns are STRING sources (compile them with the `gi` flags) so this file stays a plain,
 * dependency-free constant module that the SDKs could bundle too. Detection order matters: run
 * PII_DETECTION_ORDER (email first, phone last), because a GSTIN contains a PAN and an Aadhaar
 * group could look like a phone tail.
 *
 * ZERO dependencies (shared barrel).
 */

// ─── Kinds and fields ───────────────────────────────────────────────────────

/** WHY: what the detector looks for — the Indian-retail leaks seen in practice. */
export const PII_KIND_VALUES = ['email', 'phone', 'pan', 'gstin', 'aadhaar'] as const;
export type PiiKind = (typeof PII_KIND_VALUES)[number];

/**
 * WHY: the stored fields the scrubber inspects (and the `field` of traffic.pii_detections).
 * `userEmail` / `user.email` are NOT here: they carry an email on purpose.
 */
export const PII_FIELD_VALUES = [
  'path',
  'route_template',
  'referrer_path',
  'label',
  'prop_key',
  'prop_value',
  'tool',
  'name',
  'error_code',
  'request_id',
  'release',
] as const;
export type PiiField = (typeof PII_FIELD_VALUES)[number];

// ─── Replacement ────────────────────────────────────────────────────────────

/**
 * WHY: what a match becomes in path-like and free-text fields. Each token is at most
 * PII_MIN_MATCH_LENGTH[kind] long, so a redaction can never make a field longer than its CHECK.
 */
export const PII_REDACTION_TOKENS: Readonly<Record<PiiKind, string>> = {
  email: ':email',
  phone: ':phone',
  pan: ':pan',
  gstin: ':gstin',
  aadhaar: ':aadhaar',
};

/** WHY: the shortest string each kind's pattern can match (the bound for the tokens above). */
export const PII_MIN_MATCH_LENGTH: Readonly<Record<PiiKind, number>> = {
  email: 6,
  phone: 10,
  pan: 10,
  gstin: 15,
  aadhaar: 12,
};

/** WHY: replacement inside identifiers (`tool`, `name`) — still matches TOOL_NAME_PATTERN. */
export const PII_IDENTIFIER_REDACTION = 'redacted';

// ─── Patterns ───────────────────────────────────────────────────────────────

/** WHY: run in this order (GSTIN before PAN: a GSTIN embeds a PAN; Aadhaar before phone). */
export const PII_DETECTION_ORDER: readonly PiiKind[] = ['email', 'gstin', 'pan', 'aadhaar', 'phone'];

const EMAIL_SOURCE = '[A-Z0-9._%+-]+(?:@|%40)[A-Z0-9-]+(?:\\.[A-Z0-9-]+)*\\.[A-Z]{2,24}';
/** Post-filter with isGstinChecksumValid. */
const GSTIN_SOURCE =
  '(?<![A-Z0-9])[0-3][0-9][A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z](?![A-Z0-9])';
const PAN_SOURCE = '(?<![A-Z0-9])[A-Z]{3}[ABCFGHLJPTK][A-Z][0-9]{4}[A-Z](?![A-Z0-9])';

/**
 * WHY strict: paths are full of numeric ids, so a bare digit run is NOT PII here — Aadhaar needs
 * its separators and a phone needs +91 (the Indian `XXXXX XXXXX` grouping is allowed). Bare numbers
 * in a stored path are caught by the SEGMENT rules instead (pass 2, after the ids are hashed).
 * Also used for OPAQUE identifiers (`request_id`, `release`): random hex / UUID tokens often hold a
 * 10-digit run starting 6-9, which the loose TEXT phone rule would flag as a mobile (ADR 0010).
 * Aadhaar matches are post-filtered by Verhoeff, GSTIN by its checksum.
 */
export const PII_PATH_PATTERN_SOURCES: Readonly<Record<PiiKind, string>> = {
  email: EMAIL_SOURCE,
  gstin: GSTIN_SOURCE,
  pan: PAN_SOURCE,
  aadhaar: '(?<!\\d)[2-9]\\d{3}(?:[\\s-]|%20)\\d{4}(?:[\\s-]|%20)\\d{4}(?!\\d)',
  phone: '(?:\\+|%2B)91(?:[\\s-]|%20)?[6-9]\\d{4}(?:[\\s-]|%20)?\\d{5}(?!\\d)',
};

/**
 * WHY looser: free text (labels, prop values, tool / event names, error codes) has no ids, so a
 * bare 10-digit mobile — also written `98765 43210`, `+91-98765-43210`, `0091…` or `919876543210` —
 * or a 12-digit Aadhaar is treated as PII. Aadhaar is post-filtered by Verhoeff, GSTIN by its
 * checksum.
 */
export const PII_TEXT_PATTERN_SOURCES: Readonly<Record<PiiKind, string>> = {
  email: EMAIL_SOURCE,
  gstin: GSTIN_SOURCE,
  pan: PAN_SOURCE,
  aadhaar: '(?<!\\d)[2-9]\\d{3}[\\s-]?\\d{4}[\\s-]?\\d{4}(?!\\d)',
  phone: '(?<![\\d+])(?:(?:\\+|00)?91[\\s-]?|0)?[6-9]\\d{4}[\\s-]?\\d{5}(?!\\d)',
};

/**
 * WHY: pass 2 runs on the STORED `path` / `referrer_path` only, after RouteNormalizer and the id
 * hashing: a whole `/`-delimited segment that is a bare mobile (optionally with a bare `91` country
 * code, as in wa.me links) becomes `:phone`, a Verhoeff-valid 12-digit run `:aadhaar`. Anchored —
 * test one segment at a time. The Aadhaar source needs isVerhoeffValid as a post-filter.
 */
export const PII_SEGMENT_PATTERN_SOURCES: Readonly<{ phone: string; aadhaar: string }> = {
  phone: '^(?:91)?[6-9]\\d{9}$',
  aadhaar: '^[2-9]\\d{11}$',
};

// ─── Checksums ──────────────────────────────────────────────────────────────

const VERHOEFF_D: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * WHY: every Aadhaar number carries a Verhoeff check digit; requiring it turns "any 12 digits"
 * into roughly 1 false positive in 10. `digits` may contain the separators the Aadhaar patterns
 * allow — whitespace, `-` and the URL-encoded space `%20` (ignored) — so a raw pattern match can be
 * passed as is; any other character, or no digit at all, is invalid.
 */
export function isVerhoeffValid(digits: string): boolean {
  const clean = digits.replace(/[\s-]|%20/g, '');
  if (!/^\d+$/.test(clean)) return false;
  let check = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const digit = clean.charCodeAt(clean.length - 1 - i) - 48;
    check = VERHOEFF_D[check]![VERHOEFF_P[i % 8]![digit]!]!;
  }
  return check === 0;
}

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * WHY: the 15th character of a GSTIN is a mod-36 weighted check character (weights 1,2,1,2…;
 * each product folded as quotient + remainder of 36). Requiring it keeps random 15-char
 * identifiers that only LOOK like a GSTIN out of the redaction counters. Case-insensitive.
 */
export function isGstinChecksumValid(gstin: string): boolean {
  const value = gstin.toUpperCase();
  if (value.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const code = GSTIN_ALPHABET.indexOf(value[i]!);
    if (code < 0) return false;
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
  return value[14] === expected;
}
