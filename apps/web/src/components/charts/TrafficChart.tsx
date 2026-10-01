'use client';

import type { Grain, TimeseriesPointDto } from '@nexus/shared';
import { useReducedMotion } from 'motion/react';
import { useId } from 'react';
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

const SERIES: readonly ChartTooltipSeries[] = [
  { key: 'requests', label: 'Requests', color: CHART_COLORS.requests, format: formatInteger },
];

/** WHY: request volume over the window — one series, so the card title names it (no legend). */
export function TrafficChart({ points, grain }: { points: TimeseriesPointDto[]; grain: Grain }) {
  const reducedMotion = useReducedMotion() ?? false;
  /** Unique per instance: SVG gradient ids are document-global. */
  const gradientId = `traffic-fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <figure aria-label="Requests over time" className="m-0">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={points} margin={CHART_MARGIN}>
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
                series={SERIES}
                formatLabel={(iso) => formatBucket(iso, grain)}
              />
            )}
          />
          <Area
            type="monotone"
            dataKey="requests"
            name="Requests"
            stroke={CHART_COLORS.requests}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_COLORS.surface }}
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
