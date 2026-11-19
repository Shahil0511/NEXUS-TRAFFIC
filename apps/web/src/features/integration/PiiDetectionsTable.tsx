import type { PiiDetectionDto } from '@nexus/shared';

import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { formatInteger } from '@/lib/format';

import { PII_FIELD_LABELS, PII_KIND_LABELS, SOURCE_LABELS } from './integrationCopy';

const COLUMNS: DataTableColumn<PiiDetectionDto>[] = [
  {
    id: 'field',
    header: 'Where',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="block truncate">
        {PII_FIELD_LABELS[row.field]}{' '}
        <span className="font-mono text-2xs text-muted-foreground">{row.field}</span>
      </span>
    ),
  },
  { id: 'kind', header: 'What', cell: (row) => PII_KIND_LABELS[row.kind] },
  { id: 'source', header: 'Source', cell: (row) => SOURCE_LABELS[row.source] },
  {
    id: 'detections',
    header: 'Redacted',
    align: 'right',
    cell: (row) => <span className="tabular">{formatInteger(row.detections)}</span>,
  },
];

/**
 * WHY: the `pii_detected` warning says WHERE to look — which field of which source carried which
 * kind of personal data, busiest first. Counts only: Nexus never stores or shows the values.
 */
export function PiiDetectionsTable({
  detections,
  appName,
}: {
  detections: readonly PiiDetectionDto[];
  appName: string;
}) {
  return (
    <DataTable
      caption={`Personal data redacted for ${appName}`}
      columns={COLUMNS}
      rows={detections}
      rowKey={(row) => `${row.source}|${row.field}|${row.kind}`}
      skeletonRows={1}
    />
  );
}
