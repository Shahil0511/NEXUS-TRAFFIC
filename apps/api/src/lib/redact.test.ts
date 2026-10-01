import { describe, expect, it } from 'vitest';

import { maskEmail, maskKey, redactMeta } from './redact';

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('someone@libas.in')).toBe('s***@libas.in');
  });

  it('fully masks values without a usable local part', () => {
    expect(maskEmail('@libas.in')).toBe('***');
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

describe('maskKey', () => {
  it('keeps only the first 10 characters', () => {
    expect(maskKey(`nx_sk_${'A'.repeat(40)}`)).toBe('nx_sk_AAAA…');
  });

  it('fully masks short values', () => {
    expect(maskKey('short')).toBe('***');
    expect(maskKey('0123456789')).toBe('***');
  });
});

describe('redactMeta', () => {
  it('masks emails inside strings, arrays and nested objects', () => {
    expect(
      redactMeta({
        msg: 'login by a.b@libas.in and c@d.co',
        list: ['x@libas.in'],
        nested: { who: 'y@libas.in' },
      }),
    ).toEqual({
      msg: 'login by a***@libas.in and c***@d.co',
      list: ['x***@libas.in'],
      nested: { who: 'y***@libas.in' },
    });
  });

  it('drops string values of secret-looking keys', () => {
    expect(
      redactMeta({
        password: 'p',
        apiKey: 'nx_sk_x',
        Authorization: 'Bearer t',
        cookie: 'access_token=t',
        pepper: 'p',
        accessToken: 't',
        status: 200,
      }),
    ).toEqual({
      password: '[redacted]',
      apiKey: '[redacted]',
      Authorization: '[redacted]',
      cookie: '[redacted]',
      pepper: '[redacted]',
      accessToken: '[redacted]',
      status: 200,
    });
  });

  it('reduces errors to name + redacted message (no stack)', () => {
    const err = new TypeError('failed for z@libas.in');
    expect(redactMeta({ err })).toEqual({
      err: { name: 'TypeError', message: 'failed for z***@libas.in' },
    });
  });

  it('stops at depth 5 and passes primitives through', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } };
    expect(JSON.stringify(redactMeta(deep))).toContain('[depth]');
    expect(redactMeta(42)).toBe(42);
    expect(redactMeta(null)).toBeNull();
    expect(redactMeta(undefined)).toBeUndefined();
  });
});
