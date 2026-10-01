/**
 * Opaque user id for URLs: HMAC-SHA256(USER_KEY_SECRET, lower-cased email).
 * Stored as bytea; rendered as 64-char hex in DTOs and routes.
 */
import { createHmac } from 'node:crypto';

/** WHY: URLs and gateway logs must never carry emails, and the id cannot be derived later. */
export class UserKeyHasher {
  constructor(private readonly secret: string) {}

  hash(email: string | null): Buffer | null {
    if (!email) return null;
    return createHmac('sha256', this.secret).update(email.toLowerCase(), 'utf8').digest();
  }
}

/** bytea → 64-char hex (null-safe). */
export function userKeyToHex(userKey: Buffer | null): string | null {
  return userKey ? userKey.toString('hex') : null;
}

/** 64-char hex → bytea for queries. */
export function userKeyFromHex(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}
