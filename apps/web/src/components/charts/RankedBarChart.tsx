'use client';

import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatCompact } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, AXIS_TICK, CHART_COLORS, CHART_HEIGHT } from './chartTheme';

export interface RankedBar {
  /** Unique id of the row (two apps can share a label). */
  key: string;
  /** Category label shown on the axis (truncated) and in the tooltip (full). */
  label: string;
  value: number;
}

export interface RankedBarChartProps {
  bars: readonly RankedBar[];
  /** Names the value in the tooltip, e.g. "Requests". */
  seriesLabel: string;
  /** Accessible name of the figure. */
  ariaLabel: string;
  format: (value: number | null) => string;
  /** Value-axis ticks; compact counts by default (pass formatDuration for times). */
  tickFormat?: (value: number) => string;
  /** Width reserved for the category labels. */
  labelWidth?: number;
}

const ROW_HEIGHT = 30;
const BAR_SIZE = 14;
const LABEL_MAX_CHARS = 24;
const END_RADIUS: [number, number, number, number] = [0, 3, 3, 0];
const MARGIN = { top: 0, right: 16, bottom: 0, left: 0 } as const;

/** "/api/orders/:id/lines/:lineId" → "/api/orders/:id/lines/:l…" so the axis never overflows. */
export function truncateLabel(label: string, maxChars = LABEL_MAX_CHARS): string {
  return label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
}

/**
 * WHY: "who/what ranks highest" (countries, pages, tools) reads best as horizontal bars — long
 * category labels stay horizontal and the bar lengths compare at a glance. One series, so the
 * panel title names it (no legend); the tooltip carries the exact value and the full label.
 */
export function RankedBarChart({
  bars,
  seriesLabel,
  ariaLabel,
  format,
  tickFormat = formatCompact,
  labelWidth = 140,
}: RankedBarChartProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const labels = useMemo(() => new Map(bars.map((bar) => [bar.key, bar.label])), [bars]);
  const series: readonly ChartTooltipSeries[] = useMemo(
    () => [{ key: 'value', label: seriesLabel, color: CHART_COLORS.requests, format }],
    [seriesLabel, format],
  );
  const height = Math.max(CHART_HEIGHT, bars.length * ROW_HEIGHT);
  return (
    <figure aria-label={ariaLabel} className="m-0">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={[...bars]} layout="vertical" margin={MARGIN} barCategoryGap="22%">
          <CartesianGrid horizontal={false} stroke={CHART_COLORS.grid} />
          <XAxis
            type="number"
            {...AXIS_PROPS}
            allowDecimals={false}
            tickFormatter={(value: number) => tickFormat(value)}
          />
          <YAxis
            type="category"
            dataKey="key"
            {...AXIS_PROPS}
            tick={{ ...AXIS_TICK, fill: 'var(--foreground)' }}
            width={labelWidth}
            interval={0}
            tickFormatter={(key: string) => truncateLabel(labels.get(key) ?? key)}
          />
          <Tooltip
            cursor={{ fill: CHART_COLORS.cursor }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                series={series}
                formatLabel={(key) => labels.get(key) ?? key}
              />
            )}
          />
          <Bar
            dataKey="value"
            name={seriesLabel}
            fill={CHART_COLORS.requests}
            radius={END_RADIUS}
            barSize={BAR_SIZE}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
