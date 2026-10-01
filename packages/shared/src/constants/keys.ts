/**
 * API key format.
 *
 * WHY: one definition used by the key generator (api), the DB CHECK (migration 0002), the ingest
 * auth middleware, the dashboard display and the SDK warnings. A secret key (`nx_sk_`) belongs ONLY
 * in a server environment; a publishable key (`nx_pk_`) is write-only and may ship in a browser bundle.
 */

export const KEY_KIND_VALUES = ['secret', 'publishable'] as const;
export type KeyKind = (typeof KEY_KIND_VALUES)[number];

export const KEY_PREFIXES = {
  secret: 'nx_sk_',
  publishable: 'nx_pk_',
} as const satisfies Record<KeyKind, string>;

/** Number of random base62 characters after the prefix. */
export const KEY_RANDOM_LENGTH = {
  secret: 40,
  publishable: 32,
} as const satisfies Record<KeyKind, number>;

/** First N characters of a key, stored in clear for lookup and display (`nx_sk_` + 8 random). */
export const KEY_LOOKUP_PREFIX_LENGTH = 14;

export const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Strict shape of a full key of either kind. */
export const API_KEY_PATTERN = /^nx_(sk_[0-9A-Za-z]{40}|pk_[0-9A-Za-z]{32})$/;
