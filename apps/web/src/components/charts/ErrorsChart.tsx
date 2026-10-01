'use client';

import type { Grain, TimeseriesPointDto } from '@nexus/shared';
import { useReducedMotion } from 'motion/react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatBucket, formatCompact, formatInteger } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, CHART_COLORS, CHART_HEIGHT, CHART_MARGIN } from './chartTheme';

/** 5xx first (bottom of the stack): server faults are the ones we own. */
export const ERROR_SERIES: readonly ChartTooltipSeries[] = [
  { key: 'errors5xx', label: '5xx server', color: CHART_COLORS.errors5xx, format: formatInteger },
  { key: 'errors4xx', label: '4xx client', color: CHART_COLORS.errors4xx, format: formatInteger },
];

const TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/**
 * WHY: failures per bucket, stacked by class so the total height is "all errors" and the split
 * shows whose fault it is. Pair it with <ChartLegend series={ERROR_SERIES}/> in the card header.
 */
export function ErrorsChart({ points, grain }: { points: TimeseriesPointDto[]; grain: Grain }) {
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <figure aria-label="Failed requests over time by status class" className="m-0">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={points} margin={CHART_MARGIN} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="bucket"
            {...AXIS_PROPS}
            minTickGap={32}
            tickFormatter={(iso: string) => formatBucket(iso, grain)}
          />
          <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} tickFormatter={formatCompact} />
          <Tooltip
            cursor={{ fill: CHART_COLORS.cursor }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                series={ERROR_SERIES}
                formatLabel={(iso) => formatBucket(iso, grain)}
              />
            )}
          />
          <Bar
            dataKey="errors5xx"
            name="5xx server"
            stackId="errors"
            fill={CHART_COLORS.errors5xx}
            stroke={CHART_COLORS.surface}
            strokeWidth={1}
            isAnimationActive={!reducedMotion}
          />
          <Bar
            dataKey="errors4xx"
            name="4xx client"
            stackId="errors"
            fill={CHART_COLORS.errors4xx}
            stroke={CHART_COLORS.surface}
            strokeWidth={1}
            radius={TOP_RADIUS}
            isAnimationActive={!reducedMotion}
          />
        </BarChart>
      </ResponsiveContainer>
    </figure>
  );
}
