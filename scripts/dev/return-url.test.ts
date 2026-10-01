import { describe, expect, it } from 'vitest';

import { safeReturnUrl } from './return-url';

const FALLBACK = 'http://localhost:3305/traffic/';

describe('safeReturnUrl', () => {
  it.each([
    'http://localhost:3305/traffic/endpoints?app=demo-app',
    'http://127.0.0.1:3305/traffic/',
    'http://localhost:4000/api/docs/',
  ])('follows local http URL %s', (url) => {
    expect(safeReturnUrl(url, FALLBACK)).toBe(url);
  });

  it.each([
    null,
    undefined,
    '',
    'not a url',
    '/traffic/',
    'https://localhost:3305/traffic/',
    'http://evil.example/',
    'http://localhost.evil.example/',
    'http://user:pw@localhost:3305/',
    'javascript:alert(1)',
    '//evil.example/',
    'http://[::1]:3305/',
    'http://10.150.0.5/',
  ])('falls back for %s', (url) => {
    expect(safeReturnUrl(url, FALLBACK)).toBe(FALLBACK);
  });
});
