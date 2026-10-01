/**
 * Creates new API keys: `nx_sk_` + 40 base62 (secret) or `nx_pk_` + 32 base62 (publishable),
 * using crypto-random bytes with rejection sampling (no modulo bias).
 */
import { randomBytes } from 'node:crypto';

import {
  BASE62_ALPHABET,
  KEY_LOOKUP_PREFIX_LENGTH,
  KEY_PREFIXES,
  KEY_RANDOM_LENGTH,
  type KeyKind,
} from '@nexus/shared';

import type { ApiKeyHasher } from './api-key.hasher';

export interface GeneratedApiKey {
  kind: KeyKind;
  /** The full key — shown to the admin ONCE, never stored. */
  plaintext: string;
  keyPrefix: string;
  keyHash: Buffer;
  /** The full key again for publishable keys (stored), null for secret keys. */
  publicKey: string | null;
}

/** Source of random bytes (injectable so tests can drive the rejection sampling). */
export type RandomByteSource = (size: number) => Buffer;

/**
 * Largest multiple of the alphabet size that fits in a byte (62 × 4 = 248). Bytes ≥ this value
 * are discarded, so every alphabet character is exactly equally likely.
 */
const UNBIASED_BYTE_LIMIT = Math.floor(256 / BASE62_ALPHABET.length) * BASE62_ALPHABET.length;

/** WHY: uniform random base62 string — `byte % 62` alone would favour the first 8 characters. */
export function randomBase62(length: number, source: RandomByteSource = randomBytes): string {
  let out = '';
  while (out.length < length) {
    for (const byte of source(length - out.length + 8)) {
      if (byte >= UNBIASED_BYTE_LIMIT) continue;
      out += BASE62_ALPHABET[byte % BASE62_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** WHY: one place that knows the key format, so admin key creation cannot drift from the parser. */
export class ApiKeyGenerator {
  constructor(
    private readonly hasher: ApiKeyHasher,
    private readonly source: RandomByteSource = randomBytes,
  ) {}

  generate(kind: KeyKind): GeneratedApiKey {
    const plaintext = KEY_PREFIXES[kind] + randomBase62(KEY_RANDOM_LENGTH[kind], this.source);
    return {
      kind,
      plaintext,
      keyPrefix: plaintext.slice(0, KEY_LOOKUP_PREFIX_LENGTH),
      keyHash: this.hasher.hash(plaintext),
      publicKey: kind === 'publishable' ? plaintext : null,
    };
  }
}
