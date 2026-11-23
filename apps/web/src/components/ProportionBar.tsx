import { formatInteger } from '@/lib/format';
import { cn } from '@/lib/utils';

import { barWidthPct, shareLabel, type ProportionRow } from './proportionShares';

export interface ProportionBarProps {
  /** Accessible name of the bars (the table fallback's caption). */
  caption: string;
  rows: readonly ProportionRow[];
  /** Plural noun the shares are OF ("page views", "requests"); printed inside every label. */
  unit: string;
  /** Header of the value column in the table fallback ("Browser"). */
  valueHeader: string;
  className?: string;
}

/**
 * WHY: a breakdown read as "who uses what" must say what it counts. Each value gets one labelled
 * horizontal bar whose label carries the unit ("30% of page views") and whose width is the share
 * of the whole total. The bars are decorative for assistive tech; a screen-reader-only table
 * with the same rows is the accessible version. Labels are rendered as TEXT (ingested values).
 * Colours come from the CSS tokens (`--chart-requests`, the Libas plum; `--muted`).
 */
export function ProportionBar({ caption, rows, unit, valueHeader, className }: ProportionBarProps) {
  return (
    <div className={className}>
      <ol className="space-y-3" aria-hidden="true">
        {rows.map((row) => (
          <li key={row.key} className="space-y-1.5">
            <div className="flex items-end justify-between gap-3 text-xs">
              <span
                className={cn('min-w-0 truncate', row.muted && 'text-muted-foreground italic')}
                title={row.label}
              >
                {row.label}
              </span>
              <span className="shrink-0 font-semibold tabular">{shareLabel(row.share, unit)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="block h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    'block h-full rounded-full',
                    row.muted ? 'bg-muted-foreground/40' : 'bg-chart-requests',
                  )}
                  style={{ width: `${barWidthPct(row.share)}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-2xs text-muted-foreground tabular">
                {formatInteger(row.count)}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <ProportionTable
        caption={caption}
        rows={rows}
        unit={unit}
        valueHeader={valueHeader}
        className="sr-only"
      />
    </div>
  );
}

/**
 * The same rows as a plain table: the accessible fallback of ProportionBar (screen-reader only)
 * and the visible "Show all values" list.
 */
export function ProportionTable({
  caption,
  rows,
  unit,
  valueHeader,
  className,
}: ProportionBarProps) {
  return (
    <table className={cn('w-full text-xs', className)}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border text-2xs text-muted-foreground">
          <th scope="col" className="py-2 pr-3 text-left font-medium">
            {valueHeader}
          </th>
          <th scope="col" className="py-2 pr-3 text-right font-medium">
            Share
          </th>
          <th scope="col" className="py-2 text-right font-medium capitalize">
            {unit}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-b border-border last:border-0">
            <td
              className={cn(
                'w-full max-w-0 truncate py-2 pr-3',
                row.muted && 'text-muted-foreground italic',
              )}
            >
              {row.label}
            </td>
            <td className="py-2 pr-3 text-right whitespace-nowrap tabular">
              {shareLabel(row.share, unit)}
            </td>
            <td className="py-2 text-right tabular">{formatInteger(row.count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
