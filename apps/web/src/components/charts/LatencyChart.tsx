'use client';

import type { Grain, TimeseriesPointDto } from '@nexus/shared';
import { useReducedMotion } from 'motion/react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatBucket, formatDuration } from '@/lib/format';

import { ChartTooltip, type ChartTooltipSeries } from './ChartTooltip';
import { AXIS_PROPS, CHART_COLORS, CHART_HEIGHT, CHART_MARGIN } from './chartTheme';

const SERIES: readonly ChartTooltipSeries[] = [
  { key: 'p95Ms', label: 'p95 latency', color: CHART_COLORS.requests, format: formatDuration },
];

/**
 * WHY: p95 latency per bucket (streams excluded by the API). Gaps stay gaps — a bucket without
 * requests has no latency, and drawing through it would invent data.
 */
export function LatencyChart({ points, grain }: { points: TimeseriesPointDto[]; grain: Grain }) {
  const reducedMotion = useReducedMotion() ?? false;
  return (
    <figure aria-label="p95 latency over time" className="m-0">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <LineChart data={points} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="bucket"
            {...AXIS_PROPS}
            minTickGap={32}
            tickFormatter={(iso: string) => formatBucket(iso, grain)}
          />
          <YAxis {...AXIS_PROPS} width={56} tickFormatter={(ms: number) => formatDuration(ms)} />
          <Tooltip
            cursor={{ stroke: CHART_COLORS.requests, strokeOpacity: 0.3 }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label}
                payload={props.payload}
                series={SERIES}
                formatLabel={(iso) => formatBucket(iso, grain)}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="p95Ms"
            name="p95 latency"
            stroke={CHART_COLORS.requests}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
