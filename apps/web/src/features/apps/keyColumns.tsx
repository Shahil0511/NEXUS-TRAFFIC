'use client';

import type { ApiKeyDto } from '@nexus/shared';
import { ShieldAlert } from 'lucide-react';

import type { DataTableColumn } from '@/components/DataTable';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EMPTY_VALUE, formatDateTime } from '@/lib/format';

import { keyStatusOf, type KeyStatus } from './appForm';
import type { KeyAction } from './KeyActionDialog';

const STATUS_BADGES: Record<KeyStatus, { label: string; variant: BadgeProps['variant'] }> = {
  active: { label: 'active', variant: 'success' },
  expiring: { label: 'expiring', variant: 'warning' },
  expired: { label: 'expired', variant: 'muted' },
  revoked: { label: 'revoked', variant: 'muted' },
};

export interface KeyColumnOptions {
  nowMs: number;
  /** Opens the in-page confirmation for a key. */
  onAction: (action: KeyAction, key: ApiKeyDto) => void;
}

/**
 * The key table of one app: prefix + label, kind, status (exposed flagged), usage and the admin
 * actions. The full key NEVER appears here — only its 14-char prefix (and, for publishable keys,
 * the Integration block shows the public value).
 */
export function keyColumns({ nowMs, onAction }: KeyColumnOptions): DataTableColumn<ApiKeyDto>[] {
  return [
    {
      id: 'key',
      header: 'Key',
      className: 'w-full max-w-0',
      cell: (key) => (
        <span className="block min-w-0">
          <span className="block truncate font-mono text-xs">{key.keyPrefix}…</span>
          <span className="block truncate text-[11px] text-muted-foreground">{key.label}</span>
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (key) => <Badge variant="outline">{key.kind}</Badge>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (key) => {
        const status = keyStatusOf(key, nowMs);
        const badge = STATUS_BADGES[status];
        return (
          <span className="flex flex-wrap items-center gap-1">
            <Badge variant={badge.variant} title={key.expiresAt ? `expires ${formatDateTime(key.expiresAt)}` : undefined}>
              {badge.label}
            </Badge>
            {key.exposedAt && status !== 'revoked' ? (
              <Badge variant="destructive" title={`seen on the browser endpoint ${formatDateTime(key.exposedAt)}`}>
                <ShieldAlert aria-hidden="true" />
                exposed
              </Badge>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'lastUsed',
      header: 'Last used',
      cell: (key) => (
        <span className="block whitespace-nowrap">
          {key.lastUsedAt ? (
            <time dateTime={key.lastUsedAt}>{formatDateTime(key.lastUsedAt)}</time>
          ) : (
            <span className="text-muted-foreground">never</span>
          )}
          {key.lastSdk ? (
            <span className="block font-mono text-[11px] text-muted-foreground">{key.lastSdk}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'expires',
      header: 'Expires',
      className: 'whitespace-nowrap text-muted-foreground',
      cell: (key) =>
        key.revokedAt ? (
          <span>revoked {formatDateTime(key.revokedAt)}</span>
        ) : key.expiresAt ? (
          <time dateTime={key.expiresAt}>{formatDateTime(key.expiresAt)}</time>
        ) : (
          EMPTY_VALUE
        ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      cell: (key) => {
        const status = keyStatusOf(key, nowMs);
        if (status === 'revoked') return null;
        return (
          <span className="flex justify-end gap-1">
            {status !== 'expired' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction('expire', key)}
                aria-label={`Expire ${key.keyPrefix}`}
              >
                Expire
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onAction('revoke', key)}
              aria-label={`Revoke ${key.keyPrefix}`}
            >
              Revoke
            </Button>
          </span>
        );
      },
    },
  ];
}
