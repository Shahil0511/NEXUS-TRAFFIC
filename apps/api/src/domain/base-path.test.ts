import { describe, expect, it } from 'vitest';

import { isWithinBasePath } from './base-path';

describe('isWithinBasePath', () => {
  it.each([
    ['/ebo-sales', '/ebo-sales', true],
    ['/ebo-sales/', '/ebo-sales', true],
    ['/ebo-sales/stores/1', '/ebo-sales', true],
    ['/ebo-sales?tab=1', '/ebo-sales', true],
    ['/ebo-sales#top', '/ebo-sales', true],
    ['/ebo-sales/stores', '/ebo-sales/', true],
    ['/ebo-sales-admin', '/ebo-sales', false],
    ['/other/ebo-sales', '/ebo-sales', false],
    ['/', '/ebo-sales', false],
    ['/anything', null, true],
    ['/anything', '/', true],
  ])('%s under %s → %s', (path, basePath, expected) => {
    expect(isWithinBasePath(path, basePath)).toBe(expected);
  });
});
