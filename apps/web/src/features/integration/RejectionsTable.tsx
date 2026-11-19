import type { RejectionReasonDto } from '@nexus/shared';

import { DataTable, type DataTableColumn } from '@/components/DataTable';
import { EMPTY_VALUE, formatInteger } from '@/lib/format';

import { REJECTION_CODE_COPY, SOURCE_LABELS } from './integrationCopy';

const COLUMNS: DataTableColumn<RejectionReasonDto>[] = [
  {
    id: 'code',
    header: 'Reason',
    className: 'w-full max-w-0',
    cell: (row) => (
      <span className="block min-w-0">
        <span className="block truncate font-mono text-xs">{row.code}</span>
        <span className="block text-2xs leading-relaxed whitespace-normal text-muted-foreground">
          {REJECTION_CODE_COPY[row.code]}
        </span>
      </span>
    ),
  },
  {
    id: 'field',
    header: 'Field',
    // The normalised zod path (never the message) — ingested-shaped text, shown as text only.
    cell: (row) => <span className="font-mono text-xs">{row.schemaPath ?? EMPTY_VALUE}</span>,
  },
  {
    id: 'source',
    header: 'Source',
    cell: (row) => (
      <span className="block whitespace-nowrap">
        {SOURCE_LABELS[row.source]}
        <span className="block font-mono text-2xs text-muted-foreground">
          {row.sdk ?? 'SDK not known'}
        </span>
      </span>
    ),
  },
  {
    id: 'rejected',
    header: 'Rejected',
    align: 'right',
    cell: (row) => <span className="tabular">{formatInteger(row.rejected)}</span>,
  },
];

/**
 * WHY: "Events rejected" is only actionable with the reason. Busiest reasons first: the code with
 * what it means, the field that failed (normalised schema path) and the sending SDK.
 */
export function RejectionsTable({
  rejections,
  appName,
}: {
  rejections: readonly RejectionReasonDto[];
  appName: string;
}) {
  return (
    <DataTable
      caption={`Rejected events of ${appName}`}
      columns={COLUMNS}
      rows={rejections}
      rowKey={(row) => `${row.source}|${row.sdk ?? ''}|${row.code}|${row.schemaPath ?? ''}`}
      skeletonRows={1}
    />
  );
}
