import type { PageStatsDto } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { PAGE_STATS } from '@/test/fixtures';

import { pageKey, pageSortCaption, PAGE_SORT_VALUES, sortPages } from './pageSort';

const [ORDERS, REPORTS] = PAGE_STATS.items as [PageStatsDto, PageStatsDto];
const INVOICES: PageStatsDto = {
  ...ORDERS,
  pageId: '3c4d5e6f-7a8b-5c9d-0e1f-2a3b4c5d6e7f',
  pathTemplate: '/invoices',
  views: 420,
  distinctUsers: 80,
  p50VisibleMs: 5_000,
  exits: 3,
};
const ROWS = [REPORTS, ORDERS, INVOICES];

const templatesOf = (rows: readonly PageStatsDto[] | undefined) =>
  rows?.map((row) => row.pathTemplate);

describe('sortPages', () => {
  it('sorts by views (ties by app|template), people and exits', () => {
    expect(templatesOf(sortPages(ROWS, 'views', 'desc'))).toEqual([
      '/invoices',
      '/orders/:id',
      '/reports',
    ]);
    expect(templatesOf(sortPages(ROWS, 'people', 'desc'))).toEqual([
      '/invoices',
      '/orders/:id',
      '/reports',
    ]);
    expect(templatesOf(sortPages(ROWS, 'exits', 'asc'))).toEqual([
      '/reports',
      '/invoices',
      '/orders/:id',
    ]);
  });

  it('puts pages without a measured visible time last in both directions', () => {
    expect(templatesOf(sortPages(ROWS, 'p50', 'desc'))).toEqual([
      '/orders/:id',
      '/invoices',
      '/reports',
    ]);
    expect(templatesOf(sortPages(ROWS, 'p50', 'asc'))).toEqual([
      '/invoices',
      '/orders/:id',
      '/reports',
    ]);
    expect(templatesOf(sortPages(ROWS, 'avg', 'asc'))?.at(-1)).toBe('/reports');
  });

  it('sorts every key without touching the input', () => {
    for (const key of PAGE_SORT_VALUES) {
      expect(sortPages(ROWS, key, 'desc')).toHaveLength(3);
    }
    expect(ROWS).toEqual([REPORTS, ORDERS, INVOICES]);
    expect(sortPages(undefined, 'views', 'desc')).toBeUndefined();
    expect(pageKey(ORDERS)).toBe('ebo-sales|/orders/:id');
  });

  it('names the order in the table description', () => {
    expect(pageSortCaption('views', 'desc')).toBe('Sorted by views, most first');
    expect(pageSortCaption('sessions', 'asc')).toBe('Sorted by visits, fewest first');
    expect(pageSortCaption('p50', 'desc')).toBe('Sorted by median visible time, longest first');
  });
});
