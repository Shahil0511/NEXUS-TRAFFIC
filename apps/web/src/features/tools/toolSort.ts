import type { SortDirection, ToolUsageDto } from '@nexus/shared';

import { sortLoadedRows, sortedByCaption, type SortValueKind } from '@/lib/sortLoadedRows';

/**
 * WHY: the columns of the Features list a reader can sort by — the column ids of toolColumns and
 * the `?sort=` values of useToolListSort. Client-only (the rows are the loaded top 100), so it
 * lives here, not in the API contract.
 */
export const TOOL_SORT_VALUES = ['uses', 'people', 'sessions', 'lastUsed'] as const;

/** WHY: one sortable Features column (see TOOL_SORT_VALUES). */
export type ToolSort = (typeof TOOL_SORT_VALUES)[number];

/** WHY: most used first — the order the API ranks the loaded rows in. */
export const DEFAULT_TOOL_SORT: ToolSort = 'uses';

/** The number each sort key orders by (`null` = unknown, always last). */
const VALUE_OF: Record<ToolSort, (tool: ToolUsageDto) => number | null> = {
  uses: (tool) => tool.uses,
  people: (tool) => tool.distinctUsers,
  sessions: (tool) => tool.distinctSessions,
  lastUsed: (tool) => {
    const ms = Date.parse(tool.lastUsedAt);
    return Number.isNaN(ms) ? null : ms;
  },
};

/** How the table description names each sort key ("Sorted by uses, most first"). */
const CAPTION_OF: Record<ToolSort, { label: string; kind: SortValueKind }> = {
  uses: { label: 'uses', kind: 'count' },
  people: { label: 'people', kind: 'count' },
  sessions: { label: 'visits', kind: 'count' },
  lastUsed: { label: 'last use', kind: 'date' },
};

/** WHY: one key per feature (app + name), the row key and the tie-break of every sort. */
export function toolKey(tool: Pick<ToolUsageDto, 'app' | 'tool'>): string {
  return `${tool.app}|${tool.tool}`;
}

/**
 * WHY: orders the loaded Features rows by the chosen column (unknowns last, ties by app|name), so
 * a header click sorts at once without a new request. Pure.
 */
export function sortTools(
  rows: readonly ToolUsageDto[] | undefined,
  sort: ToolSort,
  dir: SortDirection,
): readonly ToolUsageDto[] | undefined {
  return sortLoadedRows(rows, VALUE_OF[sort], dir, toolKey);
}

/** WHY: "Sorted by uses, most first" — the Features table says how it is ordered. Pure. */
export function toolSortCaption(sort: ToolSort, dir: SortDirection): string {
  const { label, kind } = CAPTION_OF[sort];
  return sortedByCaption(label, kind, dir);
}
