'use client';

import { Search, SearchX } from 'lucide-react';
import type { Ref } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatInteger } from '@/lib/format';

/**
 * Case-insensitive "contains" over the rows ALREADY loaded (pure; unit-tested). WHY client-side:
 * the API returns a ranked top N, so the filter narrows what is on screen — it is NEVER sent to the
 * API and never put in the URL.
 */
export function filterLoadedRows<T>(
  rows: readonly T[] | undefined,
  text: string,
  labelOf: (row: T) => string,
): readonly T[] | undefined {
  const needle = text.trim().toLowerCase();
  if (!rows || needle === '') return rows;
  return rows.filter((row) => labelOf(row).toLowerCase().includes(needle));
}

/**
 * "Showing the top 100 pages — there may be more" when the list reached the API limit, null when
 * it stopped short of it. WHY neutral wording: a list that stops at exactly the limit looks
 * complete, but exactly `limit` rows may also BE everything — the API does not say which, so the
 * note must not claim "100+".
 */
export function cappedListNote(loaded: number, limit: number, noun: string): string | null {
  if (loaded < limit) return null;
  return `Showing the top ${formatInteger(limit)} ${noun} — there may be more`;
}

/**
 * The search box of a ranked table; filters the loaded rows only (see filterLoadedRows).
 * `inputRef` lets the view put focus back here after "Clear filter" (NoFilterMatch unmounts the
 * button that had focus).
 */
export function LoadedRowsFilter({
  value,
  onChange,
  label,
  placeholder,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="relative block w-full sm:w-56">
      <span className="sr-only">{label}</span>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-7 pl-8 text-xs"
        autoComplete="off"
      />
    </label>
  );
}

/**
 * "3 of 100 loaded pages match" — announced politely while the user types. The live region is
 * ALWAYS mounted (empty and visually hidden while not filtering): a status element inserted
 * together with its text is not reliably announced by screen readers.
 */
export function FilterMatchCount({
  active,
  shown,
  loaded,
  noun,
}: {
  active: boolean;
  shown: number;
  loaded: number;
  noun: string;
}) {
  return (
    <p role="status" className="px-4 pb-2 text-xs text-muted-foreground empty:sr-only">
      {active ? `${formatInteger(shown)} of ${formatInteger(loaded)} loaded ${noun} match` : null}
    </p>
  );
}

/** Nothing loaded matches the filter: say so (not "no data") and offer to clear it. */
export function NoFilterMatch({ noun, onClear }: { noun: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title={`No loaded ${noun} match this filter`}
      description="The filter only searches the rows already loaded for this window."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filter
        </Button>
      }
    />
  );
}
