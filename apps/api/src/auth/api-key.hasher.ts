/**
 * HMAC-SHA256(API_KEY_PEPPER, key) hashing and timing-safe comparison.
 * Keys are 190+ bits of randomness, so a peppered HMAC is sufficient (no bcrypt on the hot path).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** WHY: the ONLY place a raw API key is turned into its stored form (api_keys.key_hash). */
export class ApiKeyHasher {
  constructor(private readonly pepper: string) {}

  /** 32-byte digest stored in api_keys.key_hash. */
  hash(rawKey: string): Buffer {
    return createHmac('sha256', this.pepper).update(rawKey, 'utf8').digest();
  }

  /** Constant-time comparison (length checked first — timingSafeEqual throws on mismatch). */
  matches(rawKey: string, storedHash: Buffer): boolean {
    const candidate = this.hash(rawKey);
    return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
  }
}
