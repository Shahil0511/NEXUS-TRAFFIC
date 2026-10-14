'use client';

import {
  MAX_COUNT_RANGE_MS,
  RANGE_DURATIONS_MS,
  RANGE_VALUES,
  type RangePreset,
  type TimeWindowQuery,
} from '@nexus/shared';
import { ArrowRight, CalendarRange } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { RANGE_LABELS } from '@/features/filters/rangeLabels';
import { filterLinkQuery, useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { pageFiltersFor } from '@/lib/nav';
import { PAGES, withQuery } from '@/lib/pages';

/** A preset an empty page can widen to (any fixed preset; never `custom`). */
export type WiderRange = Exclude<RangePreset, 'custom'>;

const WEEK_MS = RANGE_DURATIONS_MS['7d'];

/**
 * The widening ladder, shortest first: every RANGE_VALUES preset of a week or more (7d, 30d, 90d).
 * WHY a week: an empty 15-minute window rarely fills at 1 hour; the first useful step is a week.
 */
const WIDEN_STEPS: readonly WiderRange[] = RANGE_VALUES.filter(
  (value): value is WiderRange => value !== 'custom' && RANGE_DURATIONS_MS[value] >= WEEK_MS,
);

/** Length of the current window in ms; null for a custom range whose bounds do not parse. */
export function rangeDurationMs(filters: TimeWindowQuery): number | null {
  if (filters.range !== 'custom') return RANGE_DURATIONS_MS[filters.range];
  if (!filters.from || !filters.to) return null;
  const duration = Date.parse(filters.to) - Date.parse(filters.from);
  return Number.isFinite(duration) ? duration : null;
}

/**
 * The next useful preset the page accepts (pure; unit-tested): the shortest WIDEN_STEPS preset
 * longer than the current window and within `maxRangeMs` (the page's range cap — a longer one
 * would be refused with RANGE_TOO_LARGE). Null when no wider preset fits: 30 days on a percentile
 * page (31-day cap), 90 days on a count page (93-day cap). An unparseable custom range gets the
 * first step.
 */
export function widerRange(
  filters: TimeWindowQuery,
  maxRangeMs: number = MAX_COUNT_RANGE_MS,
): WiderRange | null {
  const duration = rangeDurationMs(filters) ?? 0;
  return (
    WIDEN_STEPS.find(
      (step) => RANGE_DURATIONS_MS[step] > duration && RANGE_DURATIONS_MS[step] <= maxRangeMs,
    ) ?? null
  );
}

/**
 * WHY: "no data in this window" is usually a window that is too short, not a broken app — the
 * empty state offers the one-click fix ("Show the last 30 days") instead of sending the user to the
 * range picker. The step is capped by the CURRENT page (pageFiltersFor), so a count page still
 * offers 90 days. Once no wider preset fits, the honest next step is "is the app sending data at
 * all?", so it links to Integration health instead. Renders nothing on pages without a range.
 */
export function WidenRangeButton({ className }: { className?: string }) {
  const { filters, setRange } = useGlobalFilters();
  // Typed nullable on purpose: outside the App Router (unit tests) there is no pathname; an
  // unknown page gets every filter (pageFiltersFor's default).
  const pathname: string | null = usePathname();
  const pageFilters = pageFiltersFor(pathname ?? '');
  if (!pageFilters.range) return null;
  const next = widerRange(filters, pageFilters.maxRangeMs);
  if (!next) {
    return (
      <Button asChild variant="outline" size="sm" className={className}>
        <Link href={withQuery(PAGES.integration(), filterLinkQuery(filters))}>
          Is this app sending data?
          <ArrowRight aria-hidden="true" />
          Integration health
        </Link>
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" className={className} onClick={() => setRange(next)}>
      <CalendarRange aria-hidden="true" /> Show the {RANGE_LABELS[next].ariaLabel.toLowerCase()}
    </Button>
  );
}
