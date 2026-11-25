import type { PageStatsDto, SortDirection } from '@nexus/shared';

import { sortLoadedRows, sortedByCaption, type SortValueKind } from '@/lib/sortLoadedRows';

/**
 * WHY: the columns of the Pages list a reader can sort by — the column ids of pageColumns and the
 * `?sort=` values of usePageListSort. Client-only (the rows are the loaded top 100), so it lives
 * here, not in the API contract.
 */
export const PAGE_SORT_VALUES = ['views', 'people', 'sessions', 'avg', 'p50', 'exits'] as const;

/** WHY: one sortable Pages column (see PAGE_SORT_VALUES). */
export type PageSort = (typeof PAGE_SORT_VALUES)[number];

/** WHY: most viewed first — the order the API ranks the loaded rows in. */
export const DEFAULT_PAGE_SORT: PageSort = 'views';

/** The number each sort key orders by (`null` = not measured, always last). */
const VALUE_OF: Record<PageSort, (page: PageStatsDto) => number | null> = {
  views: (page) => page.views,
  people: (page) => page.distinctUsers,
  sessions: (page) => page.uniqueSessions,
  avg: (page) => page.avgVisibleMs,
  p50: (page) => page.p50VisibleMs,
  exits: (page) => page.exits,
};

/** How the table description names each sort key ("Sorted by median visible time, …"). */
const CAPTION_OF: Record<PageSort, { label: string; kind: SortValueKind }> = {
  views: { label: 'views', kind: 'count' },
  people: { label: 'people', kind: 'count' },
  sessions: { label: 'visits', kind: 'count' },
  avg: { label: 'average visible time', kind: 'duration' },
  p50: { label: 'median visible time', kind: 'duration' },
  exits: { label: 'exits', kind: 'count' },
};

/** WHY: one key per page (app + template), the row key and the tie-break of every sort. */
export function pageKey(page: Pick<PageStatsDto, 'app' | 'pathTemplate'>): string {
  return `${page.app}|${page.pathTemplate}`;
}

/**
 * WHY: orders the loaded Pages rows by the chosen column (nulls last, ties by app|template), so
 * a header click sorts at once without a new request. Pure.
 */
export function sortPages(
  rows: readonly PageStatsDto[] | undefined,
  sort: PageSort,
  dir: SortDirection,
): readonly PageStatsDto[] | undefined {
  return sortLoadedRows(rows, VALUE_OF[sort], dir, pageKey);
}

/** WHY: "Sorted by views, most first" — the Pages table says how it is ordered. Pure. */
export function pageSortCaption(sort: PageSort, dir: SortDirection): string {
  const { label, kind } = CAPTION_OF[sort];
  return sortedByCaption(label, kind, dir);
}
