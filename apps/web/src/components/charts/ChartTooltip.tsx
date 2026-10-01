'use client';

export interface ChartTooltipSeries {
  key: string;
  label: string;
  /** CSS colour (a var(--chart-…) token). */
  color: string;
  format: (value: number | null) => string;
}

export interface ChartTooltipProps {
  active?: boolean;
  label?: unknown;
  /** Recharts passes the hovered datum as payload[n].payload. */
  payload?: ReadonlyArray<{ payload?: unknown }>;
  series: readonly ChartTooltipSeries[];
  formatLabel: (label: string) => string;
}

function valueOf(datum: unknown, key: string): number | null {
  if (typeof datum !== 'object' || datum === null) return null;
  const value = (datum as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

/**
 * WHY: one tooltip look for every chart — bucket time in IST, then each series with its swatch
 * and a formatted value. Text uses text tokens; only the swatch carries the series colour.
 */
export function ChartTooltip({ active, label, payload, series, formatLabel }: ChartTooltipProps) {
  const datum = payload?.[0]?.payload;
  if (!active || datum === undefined) return null;
  return (
    <div className="min-w-36 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1.5 font-medium text-muted-foreground">{formatLabel(String(label))}</p>
      <ul className="space-y-1">
        {series.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-xs"
                style={{ background: item.color }}
              />
              {item.label}
            </span>
            <span className="font-semibold tabular">{item.format(valueOf(datum, item.key))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
