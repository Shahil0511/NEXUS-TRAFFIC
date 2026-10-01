/**
 * HMAC-SHA256(API_KEY_PEPPER, key) hashing and timing-safe comparison.
 * Keys are 190+ bits of randomness, so a peppered HMAC is sufficient (no bcrypt on the hot path).
 */
import { notImplemented } from '../lib/not-implemented';

export class ApiKeyHasher {
  constructor(private readonly pepper: string) {}

  /** 32-byte digest stored in api_keys.key_hash. */
  hash(rawKey: string): Buffer {
    void rawKey;
    void this.pepper;
    throw notImplemented('ApiKeyHasher.hash');
  }

  matches(rawKey: string, storedHash: Buffer): boolean {
    void rawKey;
    void storedHash;
    throw notImplemented('ApiKeyHasher.matches');
  }
}
