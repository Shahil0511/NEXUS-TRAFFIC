import {
  API_KEY_PATTERN,
  BASE62_ALPHABET,
  KEY_LOOKUP_PREFIX_LENGTH,
  KEY_PREFIXES,
  KEY_RANDOM_LENGTH,
} from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { ApiKeyGenerator, randomBase62 } from './api-key.generator';
import { ApiKeyHasher } from './api-key.hasher';
import { parseApiKey } from './api-key.parser';

const hasher = new ApiKeyHasher('p'.repeat(64));

describe('ApiKeyGenerator', () => {
  const generator = new ApiKeyGenerator(hasher);

  it('creates a secret key with no public copy', () => {
    const key = generator.generate('secret');
    expect(key.plaintext).toMatch(API_KEY_PATTERN);
    expect(key.plaintext.startsWith(KEY_PREFIXES.secret)).toBe(true);
    expect(key.plaintext).toHaveLength(KEY_PREFIXES.secret.length + KEY_RANDOM_LENGTH.secret);
    expect(key.publicKey).toBeNull();
    expect(key.kind).toBe('secret');
  });

  it('creates a publishable key whose public copy is the plaintext', () => {
    const key = generator.generate('publishable');
    expect(key.plaintext).toMatch(API_KEY_PATTERN);
    expect(key.plaintext).toHaveLength(KEY_PREFIXES.publishable.length + KEY_RANDOM_LENGTH.publishable);
    expect(key.publicKey).toBe(key.plaintext);
  });

  it('derives prefix and hash consistently with the parser and hasher', () => {
    const key = generator.generate('secret');
    expect(key.keyPrefix).toBe(key.plaintext.slice(0, KEY_LOOKUP_PREFIX_LENGTH));
    expect(parseApiKey(key.plaintext)).toEqual({ kind: 'secret', keyPrefix: key.keyPrefix });
    expect(hasher.matches(key.plaintext, key.keyHash)).toBe(true);
  });

  it('never repeats a key', () => {
    const keys = new Set(Array.from({ length: 500 }, () => generator.generate('secret').plaintext));
    expect(keys.size).toBe(500);
  });
});

describe('randomBase62', () => {
  it('discards bytes ≥ 248 (rejection sampling) instead of folding them with modulo', () => {
    // 248..255 would map to '0'..'7' under plain modulo; they must be skipped.
    const bytes = [248, 255, 0, 61, 62, 250, 123];
    let cursor = 0;
    const source = (size: number) => Buffer.from(Array.from({ length: size }, () => bytes[cursor++ % bytes.length]!));
    expect(randomBase62(4, source)).toBe(`${BASE62_ALPHABET[0]}${BASE62_ALPHABET[61]}${BASE62_ALPHABET[0]}${BASE62_ALPHABET[123 % 62]}`);
  });

  it('keeps drawing until the requested length is reached even when most bytes are rejected', () => {
    let calls = 0;
    const source = (size: number) => {
      calls += 1;
      return Buffer.alloc(size, calls % 3 === 0 ? 5 : 255);
    };
    expect(randomBase62(10, source)).toBe(BASE62_ALPHABET[5]!.repeat(10));
  });

  it('is roughly uniform over the alphabet (distribution sanity)', () => {
    const sample = randomBase62(62 * 2000);
    const counts = new Map<string, number>();
    for (const char of sample) counts.set(char, (counts.get(char) ?? 0) + 1);
    expect(counts.size).toBe(62);
    for (const count of counts.values()) {
      // Expected 2000 each; ±20 % is > 8 standard deviations — flake-free yet catches modulo bias.
      expect(count).toBeGreaterThan(1600);
      expect(count).toBeLessThan(2400);
    }
  });
});
