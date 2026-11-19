import { describe, expect, it } from 'vitest';

import { normalizeSdkLabel } from './sdk-label';

describe('normalizeSdkLabel', () => {
  it.each(['@nexus/express@1.0.0', '@nexus/react@1.1.0-beta.1', 'nexus-fastapi@1.1.0', 'curl@8.4.0+build'])(
    'keeps %s',
    (label) => {
      expect(normalizeSdkLabel(label)).toBe(label);
    },
  );

  it.each([
    [null],
    [undefined],
    [''],
    ['no-version'],
    ['@nexus/react@'],
    ['name with space@1.0'],
    ['<script>@1'],
    [`${'a'.repeat(65)}@1.0.0`],
    [`sdk@${'1'.repeat(33)}`],
    ['x'.repeat(300)],
  ])('returns "" for %s', (label) => {
    expect(normalizeSdkLabel(label)).toBe('');
  });
});
