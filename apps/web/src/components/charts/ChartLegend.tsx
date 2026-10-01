import type { ChartTooltipSeries } from './ChartTooltip';

/** WHY: with two or more series identity must not rely on colour alone — name every swatch. */
export function ChartLegend({
  series,
}: {
  series: readonly Pick<ChartTooltipSeries, 'key' | 'label' | 'color'>[];
}) {
  return (
    <ul
      className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-xs"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
