import { KEY_LOOKUP_PREFIX_LENGTH } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { parseApiKey } from './api-key.parser';

const SECRET = `nx_sk_${'A1b2C3d4E5'.repeat(4)}`;
const PUBLISHABLE = `nx_pk_${'Zz09'.repeat(8)}`;

describe('parseApiKey', () => {
  it('parses a secret key', () => {
    expect(parseApiKey(SECRET)).toEqual({ kind: 'secret', keyPrefix: SECRET.slice(0, KEY_LOOKUP_PREFIX_LENGTH) });
  });

  it('parses a publishable key', () => {
    expect(parseApiKey(PUBLISHABLE)).toEqual({ kind: 'publishable', keyPrefix: 'nx_pk_Zz09Zz09' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['secret too short', SECRET.slice(0, -1)],
    ['secret too long', `${SECRET}x`],
    ['publishable with secret length', `nx_pk_${'a'.repeat(40)}`],
    ['secret with publishable length', `nx_sk_${'a'.repeat(32)}`],
    ['unknown prefix', `nx_xx_${'a'.repeat(40)}`],
    ['non-base62 char', `nx_sk_${'a'.repeat(39)}-`],
    ['surrounding whitespace', ` ${SECRET}`],
  ])('rejects %s', (_label, raw) => {
    expect(parseApiKey(raw)).toBeNull();
  });
});
