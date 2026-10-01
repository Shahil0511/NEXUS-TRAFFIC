import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ApiKeyHasher } from './api-key.hasher';

const PEPPER = 'p'.repeat(64);
const KEY = `nx_sk_${'a'.repeat(40)}`;

describe('ApiKeyHasher', () => {
  const hasher = new ApiKeyHasher(PEPPER);

  it('produces the 32-byte HMAC-SHA256 of the key under the pepper', () => {
    const digest = hasher.hash(KEY);
    expect(digest).toHaveLength(32);
    expect(digest.equals(createHmac('sha256', PEPPER).update(KEY).digest())).toBe(true);
  });

  it('depends on the pepper', () => {
    expect(new ApiKeyHasher('q'.repeat(64)).hash(KEY).equals(hasher.hash(KEY))).toBe(false);
  });

  it('matches the stored hash of the same key', () => {
    expect(hasher.matches(KEY, hasher.hash(KEY))).toBe(true);
  });

  it('does not match another key', () => {
    expect(hasher.matches(`nx_sk_${'b'.repeat(40)}`, hasher.hash(KEY))).toBe(false);
  });

  it('returns false (does not throw) for a stored hash of the wrong length', () => {
    expect(hasher.matches(KEY, Buffer.alloc(16))).toBe(false);
  });
});
