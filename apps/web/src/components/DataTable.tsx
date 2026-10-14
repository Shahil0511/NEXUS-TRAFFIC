'use client';

import type { SortDirection } from '@nexus/shared';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { InfoTip } from '@/components/InfoTip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface DataTableColumn<T, S extends string = never> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** A whitelisted API sort key (e.g. ENDPOINT_SORT_VALUES); makes the header a sort button. */
  sortKey?: S;
  align?: 'left' | 'right';
  className?: string;
  /** What the column means, in plain words (metricInfo(key)); shown behind an (i) in the header. */
  hint?: string;
}

export interface DataTableSort<S extends string> {
  sort: S;
  dir: SortDirection;
}

export interface DataTableProps<T, S extends string = never> {
  columns: readonly DataTableColumn<T, S>[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  /** Screen-reader caption naming the table. */
  caption: string;
  sort?: DataTableSort<S>;
  onSortChange?: (next: DataTableSort<S>) => void;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered in place of the body when `rows` is empty. */
  empty?: ReactNode;
}

const DEFAULT_SKELETON_ROWS = 6;

/**
 * Next sort state after clicking a header: the same key flips the direction, a new key starts
 * descending (biggest numbers first is what an analytics table is read for).
 */
export function nextSort<S extends string>(
  current: DataTableSort<S> | undefined,
  key: S,
): DataTableSort<S> {
  if (current?.sort === key) return { sort: key, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { sort: key, dir: 'desc' };
}

function ariaSortOf<S extends string>(
  column: DataTableColumn<unknown, S>,
  sort: DataTableSort<S> | undefined,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!column.sortKey) return undefined;
  if (sort?.sort !== column.sortKey) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

function SortIcon({ state }: { state: 'ascending' | 'descending' | 'none' | undefined }) {
  if (state === 'ascending') return <ArrowUp className="size-3" aria-hidden="true" />;
  if (state === 'descending') return <ArrowDown className="size-3" aria-hidden="true" />;
  return <ArrowUpDown className="size-3 opacity-40" aria-hidden="true" />;
}

/**
 * WHY: a header's (i) explanation sits BESIDE the sort button, never inside it (a button in a
 * button is invalid and unusable by keyboard). The header text is always FIRST in the DOM, so the
 * column's accessible name — announced with every cell — starts with "p95", not "What is p95?".
 * On right-aligned columns the (i) is drawn on the left (flex-row-reverse) so the header text
 * stays flush with the numbers below it.
 */
function HeaderWithHint({
  column,
  alignRight,
  children,
}: {
  column: { header: string; hint?: string };
  alignRight: boolean;
  children: ReactNode;
}) {
  if (!column.hint) return children;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 align-middle',
        alignRight && 'flex-row-reverse',
      )}
    >
      {children}
      <InfoTip label={column.header} text={column.hint} side="bottom" />
    </span>
  );
}

/**
 * WHY: one table for every list page. Sorting is SERVER-side: a header click only reports the
 * whitelisted sort key upward (the page puts it in the URL → new query key → new request), so
 * the order always matches what the API ranked over the whole window, not just the loaded rows.
 */
export function DataTable<T, S extends string = never>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSortChange,
  loading = false,
  skeletonRows = DEFAULT_SKELETON_ROWS,
  empty,
}: DataTableProps<T, S>) {
  const showEmpty = !loading && rows !== undefined && rows.length === 0;
  return (
    <Table aria-busy={loading}>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => {
            const state = ariaSortOf(column as DataTableColumn<unknown, S>, sort);
            const alignRight = column.align === 'right';
            return (
              <TableHead
                key={column.id}
                aria-sort={state}
                className={cn(alignRight && 'text-right', column.className)}
              >
                <HeaderWithHint column={column} alignRight={alignRight}>
                  {column.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(nextSort(sort, column.sortKey as S))}
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 rounded-sm uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
                        state !== 'none' && 'text-foreground',
                        alignRight && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      <SortIcon state={state} />
                    </button>
                  ) : (
                    column.header
                  )}
                </HeaderWithHint>
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: skeletonRows }, (_, index) => (
              <TableRow key={`skeleton-${index}`} className="hover:bg-transparent">
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    <Skeleton
                      className={cn('h-4', column.align === 'right' ? 'ml-auto w-12' : 'w-28')}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
        {showEmpty ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={columns.length} className="p-0 whitespace-normal">
              {empty}
            </TableCell>
          </TableRow>
        ) : null}
        {!loading
          ? rows?.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((column) => (
                  <TableCell
                    key={column.id}
                    className={cn(
                      column.align === 'right' && 'text-right tabular',
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          : null}
      </TableBody>
    </Table>
  );
}
