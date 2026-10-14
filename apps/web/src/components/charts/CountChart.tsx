'use client';

import type { Grain } from '@nexus/shared';
import { useReducedMotion } from 'motion/react';
import { useId, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatBucket, formatCompact, formatInteger } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, CHART_COLORS, CHART_HEIGHT, CHART_MARGIN } from './chartTheme';

export interface CountPoint {
  /** ISO bucket start. */
  bucket: string;
  count: number;
}

export interface CountChartProps {
  points: readonly CountPoint[];
  grain: Grain;
  /** What is counted, e.g. "Views", "Uses", "Active users" — tooltip and accessible name. */
  label: string;
}

/**
 * WHY: one count over time — a page's views, a tool's uses, daily active users. Same look as the
 * traffic chart (area + IST bucket labels + tooltip) so every "over time" panel reads alike.
 */
export function CountChart({ points, grain, label }: CountChartProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const gradientId = `count-fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const series = useMemo<readonly ChartTooltipSeries[]>(
    () => [{ key: 'count', label, color: CHART_COLORS.requests, format: formatInteger }],
    [label],
  );
  return (
    <figure aria-label={`${label} over time`} className="m-0">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={[...points]} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.requests} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART_COLORS.requests} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="bucket"
            {...AXIS_PROPS}
            minTickGap={32}
            tickFormatter={(iso: string) => formatBucket(iso, grain)}
          />
          <YAxis {...AXIS_PROPS} width={44} allowDecimals={false} tickFormatter={formatCompact} />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.requests, strokeOpacity: 0.3 }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                series={series}
                formatLabel={(iso) => formatBucket(iso, grain)}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="count"
            name={label}
            stroke={CHART_COLORS.requests}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={points.length <= 2}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
