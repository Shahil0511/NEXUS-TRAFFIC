'use client';

import type { Grain, TimeseriesPointDto } from '@nexus/shared';
import { useReducedMotion } from 'motion/react';
import {
  CartesianGrid,
  type DotItemDotProps,
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
  const isolated = isolatedIndexes(points);
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
            // A bucket with a value but no valued neighbour has no line segment: draw it as a dot.
            dot={(props: DotItemDotProps) =>
              props.index !== undefined && isolated.has(props.index) && props.cx && props.cy ? (
                <circle
                  key={props.index}
                  cx={props.cx}
                  cy={props.cy}
                  r={3}
                  fill={CHART_COLORS.requests}
                />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            connectNulls={false}
            isAnimationActive={!reducedMotion}
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/**
 * Indexes of points that have a p95 but no p95 on either side — `connectNulls={false}` draws no
 * segment for them, so without a dot a quiet range shows an empty chart (pure; tested).
 */
export function isolatedIndexes(points: readonly { p95Ms: number | null }[]): Set<number> {
  const result = new Set<number>();
  points.forEach((point, index) => {
    if (point.p95Ms === null) return;
    const before = points[index - 1]?.p95Ms ?? null;
    const after = points[index + 1]?.p95Ms ?? null;
    if (before === null && after === null) result.add(index);
  });
  return result;
}
