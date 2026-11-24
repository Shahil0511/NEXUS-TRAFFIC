'use client';

import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatBucket, formatDay } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, CHART_COLORS, CHART_HEIGHT, CHART_MARGIN } from './chartTheme';

export interface DailyBarPoint {
  /** The instant of the day's IST midnight (ISO). */
  day: string;
  /** The bar's length of time, in ms. */
  activeMs: number;
}

export interface DailyBarChartProps<P extends DailyBarPoint> {
  /** One point per IST day, oldest first, gap-filled with 0 by the caller. */
  points: readonly P[];
  /** Names the value in the tooltip and the figure, e.g. "Tab visible time". */
  label: string;
  format: (ms: number | null) => string;
  /** Muted tooltip lines under the value for the hovered day (its other facts). */
  notes?: (point: P) => readonly string[];
}

const MS_PER_HOUR = 3_600_000;
const END_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/** Value-axis tick in hours: 0 → "0", 5_400_000 → "1.5 h". */
function formatHoursTick(ms: number): string {
  if (ms === 0) return '0';
  return `${Math.round((ms / MS_PER_HOUR) * 10) / 10} h`;
}

/**
 * WHY: a length of time per IST day (one person's tab visible time) as plain vertical bars, one
 * per day, in ONE data colour. There is deliberately no average, target or reference line: the
 * chart shows what happened on each day, not how a day compares with a goal.
 */
export function DailyBarChart<P extends DailyBarPoint>({
  points,
  label,
  format,
  notes,
}: DailyBarChartProps<P>) {
  const reducedMotion = useReducedMotion() ?? false;
  const series = useMemo<readonly ChartTooltipSeries[]>(
    () => [{ key: 'activeMs', label, color: CHART_COLORS.requests, format }],
    [label, format],
  );
  return (
    <figure aria-label={`${label} per day`} className="m-0">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={[...points]} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="day"
            {...AXIS_PROPS}
            minTickGap={24}
            tickFormatter={(iso: string) => formatBucket(iso, 'day')}
          />
          <YAxis {...AXIS_PROPS} width={44} tickFormatter={formatHoursTick} />
          <Tooltip
            cursor={{ fill: CHART_COLORS.cursor }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                series={series}
                formatLabel={formatDay}
                notes={notes ? (datum) => notes(datum as P) : undefined}
              />
            )}
          />
          <Bar
            dataKey="activeMs"
            name={label}
            fill={CHART_COLORS.requests}
            radius={END_RADIUS}
            maxBarSize={28}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
