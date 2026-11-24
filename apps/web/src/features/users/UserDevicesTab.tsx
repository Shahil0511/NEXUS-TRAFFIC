'use client';

import { type TimeWindowQuery, USER_DEVICES_LIMIT, type UserDeviceDto } from '@nexus/shared';
import { MonitorSmartphone } from 'lucide-react';
import { useMemo } from 'react';

import { AppChipList } from '@/components/AppChip';
import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { Panel } from '@/components/Panel';
import { RelativeTime } from '@/components/RelativeTime';
import { WidenRangeButton } from '@/components/WidenRangeButton';
import { formatDateTime, formatInteger, formatOsName } from '@/lib/format';
import { METRIC_COPY, metricInfo } from '@/lib/metricCopy';

import { DeviceValue } from './PersonIdentityCard';
import { UNKNOWN_FACT } from './personFacts';
import { useUserDevices } from './useUserDevices';

/**
 * WHY: "on what does this person use the apps?" — one row per device type + browser + operating
 * system seen in the range, over API calls and page views, most recently used first. The list is
 * read only while this tab is open (one 'Devices' entry in the access log per real look).
 */
export function UserDevicesTab({
  userKey,
  filters,
  linkQuery,
}: {
  userKey: string;
  filters: TimeWindowQuery;
  linkQuery: Record<string, string | undefined>;
}) {
  const devices = useUserDevices(userKey, filters);
  const columns = useMemo(() => deviceColumns(linkQuery), [linkQuery]);
  const rows = devices.data?.items;
  if (devices.isError) {
    return <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />;
  }
  return (
    <Panel
      title="Devices"
      icon={MonitorSmartphone}
      description="Each row is one device type, browser and operating system seen in this range, most recently used first."
      contentClassName="px-0 pb-0"
    >
      <DataTable
        caption="Devices"
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.device}|${row.browser}|${row.os}`}
        loading={devices.isPending}
        empty={<EmptyState title="No activity in this range" action={<WidenRangeButton />} />}
      />
      <p className="px-4 py-3 text-2xs text-muted-foreground">
        {UNKNOWN_FACT} means the browser details were missing or could not be read (for example a
        call made by a server).
        {rows && rows.length >= USER_DEVICES_LIMIT
          ? ` Showing the ${USER_DEVICES_LIMIT} most recently used.`
          : ''}
      </p>
    </Panel>
  );
}

/**
 * WHY so few columns: the tab shares the page with the identity card, so the table must fit
 * without sideways scrolling from 1280 px. Browser and operating system share a cell (two lines),
 * and the first sighting sits under the last one.
 */
function deviceColumns(
  linkQuery: Record<string, string | undefined>,
): DataTableColumn<UserDeviceDto>[] {
  return [
    {
      id: 'device',
      header: 'Device',
      cell: (row) => <DeviceValue device={row.device} />,
    },
    {
      id: 'system',
      header: 'Browser and system',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.browser ?? UNKNOWN_FACT}</span>
          <span className="text-xs text-muted-foreground">
            {row.os ? formatOsName(row.os) : UNKNOWN_FACT}
          </span>
        </span>
      ),
    },
    {
      id: 'seen',
      header: 'Last seen',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <RelativeTime iso={row.lastSeenAt} />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            First {formatDateTime(row.firstSeenAt)}
          </span>
        </span>
      ),
    },
    {
      id: 'pageViews',
      header: 'Page views',
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.pageViews)}</span>,
    },
    {
      id: 'requests',
      header: METRIC_COPY.requests.label,
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.requests)}</span>,
    },
    {
      id: 'visits',
      header: 'Visits',
      hint: metricInfo('sessions'),
      align: 'right',
      cell: (row) => <span className="tabular">{formatInteger(row.visits)}</span>,
    },
    {
      id: 'apps',
      header: 'Apps',
      className: 'w-full min-w-32 whitespace-normal',
      cell: (row) => <AppChipList apps={row.apps} linkQuery={linkQuery} max={3} />,
    },
  ];
}
