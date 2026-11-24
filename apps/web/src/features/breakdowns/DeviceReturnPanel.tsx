'use client';

import type { DeviceReturnDto, TimeWindowQuery } from '@nexus/shared';
import { Repeat } from 'lucide-react';

import { EmptyState } from '@/components/EmptyState';
import { InfoTip } from '@/components/InfoTip';
import { ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { formatInteger, formatPercent } from '@/lib/format';
import { metricInfo, RETURNING_LOOKBACK_DAYS, type MetricKey } from '@/lib/metricCopy';
import { cn } from '@/lib/utils';

import { useDeviceReturn } from './useDeviceReturn';

const PERCENT = 100;

/** Share 0..100 of returning devices; null without devices. */
export function returningPct(dto: DeviceReturnDto): number | null {
  return dto.devices > 0 ? (dto.returningDevices / dto.devices) * PERCENT : null;
}

interface StatProps {
  label: string;
  metric: MetricKey;
  value: number;
  /** Bar colour of the split (new / returning); none for the total. */
  swatch?: string;
}

function Stat({ label, metric, value, swatch }: StatProps) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="flex items-center gap-1 text-2xs text-muted-foreground">
        {swatch ? (
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', swatch)} />
        ) : null}
        <span className="truncate">{label}</span>
        <InfoTip label={label} text={metricInfo(metric)} />
      </dt>
      <dd className="text-lg font-semibold tabular">{formatInteger(value)}</dd>
    </div>
  );
}

/** The new / returning split as one proportional bar (decorative; the numbers say it). */
function SplitBar({ dto }: { dto: DeviceReturnDto }) {
  const returning = returningPct(dto) ?? 0;
  return (
    <span className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span className="h-full bg-primary" style={{ width: `${PERCENT - returning}%` }} />
      <span className="h-full bg-success" style={{ width: `${returning}%` }} />
    </span>
  );
}

/**
 * WHY: do people come back? Devices (the tracker's anonymous device id) that opened a page in the
 * window, split into new and returning — returning = also seen in the RETURNING_LOOKBACK_DAYS before the
 * window. Follows the page's app, range and environment.
 */
export function DeviceReturnPanel({
  filters,
  className,
  title = 'New vs returning',
}: {
  filters: TimeWindowQuery;
  className?: string;
  /** Panel title; Devices & places says "First-time vs returning devices". */
  title?: string;
}) {
  const devices = useDeviceReturn(filters);
  const dto = devices.data;
  return (
    <Panel
      title={title}
      icon={Repeat}
      description={`Returning = also seen in the ${RETURNING_LOOKBACK_DAYS} days before`}
      className={className}
    >
      <QueryState
        query={devices}
        skeleton={<ListSkeleton rows={3} />}
        isEmpty={dto?.devices === 0}
        empty={
          <EmptyState
            title="No devices in this window"
            description="Devices appear once the browser tracker sends page views."
          />
        }
      >
        {() => (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Devices" metric="devices" value={dto!.devices} />
              <Stat label="New" metric="newDevices" value={dto!.newDevices} swatch="bg-primary" />
              <Stat
                label="Returning"
                metric="returningDevices"
                value={dto!.returningDevices}
                swatch="bg-success"
              />
            </dl>
            <SplitBar dto={dto!} />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular">
                {formatPercent(returningPct(dto!), 0)}
              </span>{' '}
              of devices came back.
            </p>
          </div>
        )}
      </QueryState>
    </Panel>
  );
}
