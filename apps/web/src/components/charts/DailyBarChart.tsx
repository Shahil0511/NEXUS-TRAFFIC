'use client';

import { useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatBucket, formatDay, formatHoursMinutesShort } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, CHART_COLORS, CHART_HEIGHT, CHART_MARGIN } from './chartTheme';
import { durationTicks } from './durationTicks';

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

const END_RADIUS: [number, number, number, number] = [3, 3, 0, 0];
/** Room for the widest tick label ("1h 30m" at 11 px) plus AXIS_PROPS.tickMargin. */
const VALUE_AXIS_WIDTH = 52;

/**
 * WHY: recharts wraps a tick label at its spaces when the label is wider than its measured room,
 * so "1h 30m" was drawn as "1h" over "30m" and read like a second "1h". A no-break space keeps
 * the label on one line; it looks the same as a space.
 */
export function formatValueTick(ms: number): string {
  return formatHoursMinutesShort(ms).replaceAll(' ', ' ');
}

/**
 * WHY: a length of time per IST day (one person's tab visible time) as plain vertical bars, one
 * per day, in ONE data colour. There is deliberately no average, target or reference line: the
 * chart shows what happened on each day, not how a day compares with a goal. The value axis has
 * its own whole-minute ticks from the largest bar (durationTicks), so no two labels repeat, in the
 * short form of the tooltip's hours and minutes (formatHoursMinutesShort).
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
  const ticks = useMemo(
    () => durationTicks(Math.max(0, ...points.map((point) => point.activeMs))),
    [points],
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
          <YAxis
            {...AXIS_PROPS}
            width={VALUE_AXIS_WIDTH}
            ticks={ticks}
            domain={[0, ticks.at(-1) ?? 0]}
            interval={0}
            tickFormatter={formatValueTick}
          />
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
