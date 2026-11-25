import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { metricInfo } from '@/lib/metricCopy';

import { healthHeadline } from './healthHeadline';

/** The sentence as plain text (what a reader sees, without the info tips). */
const textOf = (parts: readonly SentencePart[]) =>
  parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');

const numbersOf = (parts: readonly SentencePart[]) =>
  parts.filter((part): part is Exclude<SentencePart, string> => typeof part !== 'string');

describe('healthHeadline', () => {
  it('states every count with the old cards’ hints', () => {
    const parts = healthHeadline(
      { healthy: 3, stale: 1, never: 2, needsAttention: 2, complete: 1 },
      6,
    );
    expect(textOf(parts)).toBe(
      '3 of 6 apps healthy (events in the last 24 h). 1 stale (nothing recent), 2 with no events yet (registered, never sent). 2 need attention (apps with warnings). 1 fully integrated (linked, identified, tagged).',
    );
  });

  it('speaks in the singular for one app and one app needing attention', () => {
    const parts = healthHeadline(
      { healthy: 0, stale: 1, never: 0, needsAttention: 1, complete: 0 },
      1,
    );
    expect(textOf(parts)).toContain('0 of 1 app healthy');
    expect(textOf(parts)).toContain('1 needs attention (apps with warnings).');
  });

  it('colours only a non-zero attention count amber and explains fully integrated', () => {
    const calm = numbersOf(
      healthHeadline({ healthy: 2, stale: 0, never: 0, needsAttention: 0, complete: 2 }, 2),
    );
    expect(calm.some((part) => part.tone)).toBe(false);
    const attention = numbersOf(
      healthHeadline({ healthy: 2, stale: 0, never: 0, needsAttention: 2, complete: 0 }, 2),
    );
    expect(attention.filter((part) => part.tone).map((part) => [part.text, part.tone])).toEqual([
      ['2', 'warning'],
    ]);
    expect(attention.at(-1)?.info).toEqual({
      label: 'Fully integrated',
      text: metricInfo('integrationLevel'),
    });
  });
});
