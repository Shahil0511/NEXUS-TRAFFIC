import { INGEST_LIMITS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { PathSanitizer } from './path.sanitizer';

describe('PathSanitizer', () => {
  const sanitizer = new PathSanitizer();

  it.each([
    ['/api/stores', '/api/stores'],
    ['/api/stores?token=abc&x=1', '/api/stores'],
    ['/api/stores#section', '/api/stores'],
    ['/api/stores#frag?not-a-query', '/api/stores'],
    ['/api/stores?q=1#frag', '/api/stores'],
    ['api/stores', '/api/stores'],
    ['?only=query', '/'],
    ['/', '/'],
  ])('%s → %s', (raw, expected) => {
    expect(sanitizer.sanitize(raw)).toEqual({ path: expected, truncated: false });
  });

  it('truncates to maxStoredPathLength and flags it', () => {
    const long = `/${'a'.repeat(INGEST_LIMITS.maxStoredPathLength + 50)}`;
    const result = sanitizer.sanitize(long);
    expect(result.truncated).toBe(true);
    expect(result.path).toHaveLength(INGEST_LIMITS.maxStoredPathLength);
    expect(result.path.startsWith('/')).toBe(true);
  });

  it('does not flag a path that is exactly the limit', () => {
    const exact = `/${'a'.repeat(INGEST_LIMITS.maxStoredPathLength - 1)}`;
    expect(sanitizer.sanitize(`${exact}?q=${'x'.repeat(100)}`)).toEqual({ path: exact, truncated: false });
  });
});
