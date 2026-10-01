import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { UserKeyHasher, userKeyFromHex, userKeyToHex } from './user-key.hasher';

const SECRET = 'u'.repeat(64);

describe('UserKeyHasher', () => {
  const hasher = new UserKeyHasher(SECRET);

  it('is HMAC-SHA256 of the lower-cased email', () => {
    const expected = createHmac('sha256', SECRET).update('saurabh@libas.in').digest();
    expect(hasher.hash('Saurabh@LIBAS.in')?.equals(expected)).toBe(true);
    expect(hasher.hash('saurabh@libas.in')).toHaveLength(32);
  });

  it.each([null, ''])('no email (%j) → null', (email) => {
    expect(hasher.hash(email)).toBeNull();
  });

  it('round-trips through hex', () => {
    const key = hasher.hash('a@b.co');
    const hex = userKeyToHex(key);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(userKeyFromHex(hex!).equals(key!)).toBe(true);
    expect(userKeyToHex(null)).toBeNull();
  });
});
