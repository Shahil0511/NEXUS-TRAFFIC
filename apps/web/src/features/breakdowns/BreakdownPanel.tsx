'use client';

import type {
  BreakdownDimension,
  BreakdownDto,
  IngestSource,
  TimeWindowQuery,
} from '@nexus/shared';
import { useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { InfoTip } from '@/components/InfoTip';
import { ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { RankedList, type RankedItem } from '@/components/RankedList';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatInteger, formatPercent } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';

import { breakdownValueLabel, DIMENSION_COPY } from './breakdownCopy';
import { useBreakdown } from './useBreakdown';

/** Rows of a breakdown list (the app page's top-N size; the API caps it at BREAKDOWN_LIMIT_MAX). */
export const BREAKDOWN_TOP_N = 8;

const PERCENT = 100;

export interface BreakdownPanelProps {
  title: string;
  /** The page's filters (app, range, environment). */
  filters: TimeWindowQuery;
  /** The dimensions the picker offers; the first is shown first. Server: see dimensionsFor. */
  dimensions: readonly [BreakdownDimension, ...BreakdownDimension[]];
  source?: IngestSource;
  limit?: number;
  className?: string;
}

/**
 * The list rows of one breakdown: a known value's name or the INGESTED value as plain text (never
 * a link or markup), the share of all events of the window and the count.
 */
export function breakdownItems(breakdown: BreakdownDto): RankedItem[] {
  return breakdown.items.map((item) => ({
    key: item.value ?? '',
    label:
      item.value === null ? (
        <span className="text-muted-foreground italic">
          {breakdownValueLabel(breakdown.dimension, null)}
        </span>
      ) : (
        breakdownValueLabel(breakdown.dimension, item.value)
      ),
    sublabel: `${formatPercent(item.share * PERCENT)} of ${formatInteger(breakdown.total)} events`,
    value: item.events,
  }));
}

/**
 * WHY: "who are the people behind the numbers" — the top values of one dimension (browser, OS,
 * device, time zone, language, referrer, release, environment …) with their share, switchable
 * in place. Reads the page's filters, so it follows the app, range and environment.
 */
export function BreakdownPanel({
  title,
  filters,
  dimensions,
  source = 'browser',
  limit = BREAKDOWN_TOP_N,
  className,
}: BreakdownPanelProps) {
  const [dimension, setDimension] = useState<BreakdownDimension>(dimensions[0]);
  const breakdown = useBreakdown({ ...filters, source, dimension, limit });
  const copy = DIMENSION_COPY[dimension];

  return (
    <Panel
      title={title}
      description={copy.description}
      className={className}
      aside={
        <span className="flex min-w-0 items-center gap-2">
          <InfoTip label="Share" text={metricInfo('breakdownShare')} />
          {dimensions.length > 1 ? (
            <Select
              value={dimension}
              onValueChange={(value) => setDimension(value as BreakdownDimension)}
            >
              <SelectTrigger aria-label={`${title}: dimension`} className="w-40 min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dimensions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {DIMENSION_COPY[option].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </span>
      }
    >
      <QueryState
        query={breakdown}
        skeleton={<ListSkeleton />}
        isEmpty={breakdown.data?.items.length === 0}
        empty={
          <EmptyState
            title={`No ${copy.label.toLowerCase()} data in this window`}
            description="Values appear once the tracker sends them for this app, range and environment."
          />
        }
      >
        {() => (
          // Named after the dimension the DATA is for: while a newly picked dimension loads, the
          // previous list stays (keepPreviousData) and must not be announced under the new name.
          <RankedList
            ariaLabel={`${title} by ${DIMENSION_COPY[breakdown.data!.dimension].label.toLowerCase()}`}
            items={breakdownItems(breakdown.data!)}
          />
        )}
      </QueryState>
    </Panel>
  );
}
