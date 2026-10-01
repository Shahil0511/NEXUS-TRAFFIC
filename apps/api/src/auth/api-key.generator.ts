/**
 * Creates new API keys: `nx_sk_` + 40 base62 (secret) or `nx_pk_` + 32 base62 (publishable),
 * using crypto-random bytes with rejection sampling (no modulo bias).
 */
import type { KeyKind } from '@nexus/shared';

import { notImplemented } from '../lib/not-implemented';
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

export class ApiKeyGenerator {
  constructor(private readonly hasher: ApiKeyHasher) {}

  generate(kind: KeyKind): GeneratedApiKey {
    void kind;
    void this.hasher;
    throw notImplemented('ApiKeyGenerator.generate');
  }
}
