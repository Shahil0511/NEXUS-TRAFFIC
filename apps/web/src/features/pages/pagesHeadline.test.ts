import type { PageStatsDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import type { SentencePart } from '@/components/HeadlineSentence';
import { findBannedWords } from '@/lib/neutralCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { PAGE_ID, PAGE_STATS } from '@/test/fixtures';

import { longestMedianPages, pagesHeadline, topExitPages } from './pagesHeadline';

const ORDERS: PageStatsDto = PAGE_STATS.items[0]!;
const REPORTS: PageStatsDto = PAGE_STATS.items[1]!;
const LINK_QUERY = { app: 'ebo-sales', range: '7d' };
const ORDERS_HREF = withQuery(PAGES.pageDetail('ebo-sales', PAGE_ID), LINK_QUERY);

/** The sentence as one string (what a reader reads). */
function textOf(parts: readonly SentencePart[]): string {
  return parts.map((part) => (typeof part === 'string' ? part : part.text)).join('');
}

/** The linked parts as [text, href] pairs. */
function linksOf(parts: readonly SentencePart[]): [string, string][] {
  return parts.flatMap((part) =>
    typeof part !== 'string' && part.href ? [[part.text, part.href] as [string, string]] : [],
  );
}

describe('pagesHeadline', () => {
  it('states pages and views, names the longest page and the top exit, each a link', () => {
    const parts = pagesHeadline(PAGE_STATS.items, LINK_QUERY);
    expect(textOf(parts)).toBe(
      '2 pages viewed 432 times in this range. People look longest at /orders/:id (median 31.00 s). Most visits end on /orders/:id (50 visits).',
    );
    expect(linksOf(parts)).toEqual([
      ['/orders/:id', ORDERS_HREF],
      ['/orders/:id', ORDERS_HREF],
    ]);
    expect(findBannedWords(textOf(parts))).toEqual([]);
  });

  it('says when no visible time was measured and leaves out the exit part without exits', () => {
    expect(textOf(pagesHeadline([REPORTS], {}))).toBe(
      "1 page viewed 12 times in this range. No visible time measured yet: it appears once the app's browser tracker sends it.",
    );
  });

  it('handles singulars', () => {
    const one = { ...ORDERS, views: 1, exits: 1 };
    expect(textOf(pagesHeadline([one], {}))).toBe(
      '1 page viewed 1 time in this range. People look longest at /orders/:id (median 31.00 s). Most visits end on /orders/:id (1 visit).',
    );
  });

  it('words a capped list (the API limit reached) as a bound, never as the range total', () => {
    const parts = pagesHeadline(PAGE_STATS.items, LINK_QUERY, true);
    expect(textOf(parts)).toBe(
      'The 2 most viewed pages were viewed 432 times in this range. People look longest at /orders/:id (median 31.00 s). Most visits end on /orders/:id (50 visits).',
    );
    expect(linksOf(parts)).toEqual([
      ['/orders/:id', ORDERS_HREF],
      ['/orders/:id', ORDERS_HREF],
    ]);
    expect(findBannedWords(textOf(parts))).toEqual([]);
  });

  it('says plainly that nothing was viewed', () => {
    expect(pagesHeadline([], {})).toEqual(['No page was viewed in this range.']);
  });
});

describe('longestMedianPages / topExitPages', () => {
  it('picks only pages with a measured visible time, longest first', () => {
    expect(longestMedianPages(PAGE_STATS.items)).toEqual([ORDERS]);
    const longer = { ...REPORTS, p50VisibleMs: 60_000 };
    expect(longestMedianPages([ORDERS, longer], 2)).toEqual([longer, ORDERS]);
  });

  it('picks only pages some visit ended on, most exits first, without reordering the input', () => {
    const items = [REPORTS, ORDERS];
    expect(topExitPages(items)).toEqual([ORDERS]);
    expect(items).toEqual([REPORTS, ORDERS]);
  });
});
