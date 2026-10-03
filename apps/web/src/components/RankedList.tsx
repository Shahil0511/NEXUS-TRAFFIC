import type { ReactNode } from 'react';

import { CHART_COLORS } from '@/components/charts/chartTheme';
import { formatInteger } from '@/lib/format';

export interface RankedItem {
  key: string;
  label: ReactNode;
  /** Small muted line under the label (e.g. the app). */
  sublabel?: ReactNode;
  value: number;
}

export interface RankedListProps {
  items: readonly RankedItem[];
  ariaLabel: string;
  format?: (value: number) => string;
}

const PERCENT = 100;

/**
 * WHY: a short top-N (a user's pages and tools, exit pages) with proportional bars. HTML rather
 * than an SVG chart: every row is directly labelled with its value, so it reads like a table and
 * needs no tooltip (same idea as StatusBreakdown).
 */
export function RankedList({ items, ariaLabel, format = formatInteger }: RankedListProps) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ol className="space-y-3" aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.key} className="space-y-1.5">
          <div className="flex items-end justify-between gap-3 text-xs">
            <span className="min-w-0">
              <span className="block truncate">{item.label}</span>
              {item.sublabel ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {item.sublabel}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 font-semibold tabular">{format(item.value)}</span>
          </div>
          <span className="block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${(item.value / max) * PERCENT}%`,
                background: CHART_COLORS.requests,
              }}
            />
          </span>
        </li>
      ))}
    </ol>
  );
}
