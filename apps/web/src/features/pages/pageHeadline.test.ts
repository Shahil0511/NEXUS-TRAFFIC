import type { PageStatsDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { findBannedWords } from '@/lib/neutralCopy';
import { PAGE_STATS } from '@/test/fixtures';

import { exitRateOf, pageHeadline } from './pageHeadline';

const PAGE: PageStatsDto = PAGE_STATS.items[0]!;

/** The sentence as one string (what a reader reads). */
function textOf(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

describe('pageHeadline', () => {
  it('states views, people, visits, visible time and exits in one sentence', () => {
    const sentence = textOf(pageHeadline(PAGE));
    expect(sentence).toBe(
      'Viewed 420 times by 64 verified people in 200 visits in this range. People look at it for about 48 s (median 31 s). 25.0% of visits end here.',
    );
    expect(findBannedWords(sentence)).toEqual([]);
  });

  it('makes every number bold (an object part)', () => {
    const numbers = pageHeadline(PAGE).filter((part) => typeof part !== 'string');
    expect(numbers.map((part) => (part as { text: string }).text)).toEqual([
      '420 times',
      '64 verified people',
      '200 visits',
      '48 s',
      '31 s',
      '25.0%',
    ]);
  });

  it('leaves out the visible time without one and the exits when none ended here', () => {
    expect(
      textOf(pageHeadline({ ...PAGE, avgVisibleMs: null, p50VisibleMs: null, exits: 0 })),
    ).toBe('Viewed 420 times by 64 verified people in 200 visits in this range.');
  });

  it('uses the singular for one view, one person and one visit; minutes stay minutes', () => {
    expect(
      textOf(
        pageHeadline({
          ...PAGE,
          views: 1,
          distinctUsers: 1,
          uniqueSessions: 1,
          exits: 1,
          avgVisibleMs: 100_000,
          p50VisibleMs: null,
        }),
      ),
    ).toBe(
      'Viewed 1 time by 1 verified person in 1 visit in this range. People look at it for about 1m 40s. 100.0% of visits end here.',
    );
  });

  it('rounds to whole seconds before choosing the format: 59.6 s reads 1m 0s, not 60 s', () => {
    const at = (avgVisibleMs: number) =>
      textOf(pageHeadline({ ...PAGE, avgVisibleMs, p50VisibleMs: null, exits: 0 }));
    expect(at(59_600)).toContain('about 1m 0s.');
    expect(at(59_400)).toContain('about 59 s.');
    expect(at(119_600)).toContain('about 2m 0s.');
    expect(at(350)).toContain('about 350 ms.');
  });
});

describe('exitRateOf', () => {
  it('is the share of visits that ended here, null without visits', () => {
    expect(exitRateOf({ exits: 50, uniqueSessions: 200 })).toBe(25);
    expect(exitRateOf({ exits: 0, uniqueSessions: 0 })).toBeNull();
  });
});
