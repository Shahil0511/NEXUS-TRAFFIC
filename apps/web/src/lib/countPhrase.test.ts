import { describe, expect, it } from 'vitest';

import { countPhrase, verifiedPeople } from './countPhrase';

describe('countPhrase', () => {
  it('uses the singular for exactly one, the plural otherwise, with Indian grouping', () => {
    expect(countPhrase(1, 'time', 'times')).toBe('1 time');
    expect(countPhrase(0, 'time', 'times')).toBe('0 times');
    expect(countPhrase(123_456, 'visit', 'visits')).toBe('1,23,456 visits');
  });

  it('counts verified people', () => {
    expect(verifiedPeople(1)).toBe('1 verified person');
    expect(verifiedPeople(9)).toBe('9 verified people');
  });
});
