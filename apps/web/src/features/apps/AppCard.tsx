'use client';

import type { ApiKeyDto, AppDto } from '@nexus/shared';
import { ArrowUpRight, KeyRound, Pencil } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EMPTY_VALUE, formatDateTime } from '@/lib/format';
import { guideHref } from '@/lib/guide';

import { currentPublishableKey } from './appForm';
import type { KeyAction } from './KeyActionDialog';
import { keyColumns } from './keyColumns';

export interface AppCardProps {
  app: AppDto;
  nowMs: number;
  /** `${PUBLIC_ORIGIN}/traffic` from the server env, or null when unknown. */
  nexusUrl: string | null;
  onEdit: (app: AppDto) => void;
  onCreateKey: (app: AppDto) => void;
  onKeyAction: (action: KeyAction, app: AppDto, key: ApiKeyDto) => void;
}

/** A label + value row of the details grid. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs">{children}</dd>
    </div>
  );
}

/**
 * The values a team copies into its config: NEXUS_URL, the current publishable key (public by
 * design) and the guide. The secret key is NEVER shown again after creation.
 */
function IntegrationBlock({ app, nowMs, nexusUrl }: Pick<AppCardProps, 'app' | 'nowMs' | 'nexusUrl'>) {
  const publishable = currentPublishableKey(app, nowMs);
  return (
    <section
      aria-label={`Integration values for ${app.displayName}`}
      className="space-y-2 rounded-lg bg-muted/40 p-3 ring-1 ring-border/60 ring-inset"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Integration values</h3>
        <a
          href={guideHref('keys')}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Guide
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </a>
      </div>
      <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
        <span className="text-foreground">NEXUS_URL</span>={nexusUrl ?? '<the Traffic URL>'}
        {'\n'}
        <span className="text-foreground">NEXUS_SECRET_KEY</span>=nx_sk_… (shown once, at creation)
        {'\n'}
        <span className="text-foreground">NEXT_PUBLIC_NEXUS_KEY</span>=
        {publishable?.publicKey ?? '(issue a publishable key)'}
      </pre>
    </section>
  );
}

/** WHY: one registered app — settings, integration values and its keys with the admin actions. */
export function AppCard({ app, nowMs, nexusUrl, onEdit, onCreateKey, onKeyAction }: AppCardProps) {
  const headingId = `app-${app.slug}`;
  const columns = useMemo(
    () => keyColumns({ nowMs, onAction: (action, key) => onKeyAction(action, app, key) }),
    [nowMs, onKeyAction, app],
  );

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <CardTitle id={headingId} className="truncate">
              {app.displayName}
            </CardTitle>
            {app.isActive ? null : <Badge variant="destructive">disabled</Badge>}
            {app.browserIngestEnabled ? null : <Badge variant="muted">browser ingest off</Badge>}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{app.slug}</p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" onClick={() => onEdit(app)} aria-label={`Edit ${app.displayName}`}>
            <Pencil aria-hidden="true" />
            Edit
          </Button>
          <Button size="sm" onClick={() => onCreateKey(app)} aria-label={`New key for ${app.displayName}`}>
            <KeyRound aria-hidden="true" />
            New key
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Detail label="Base path">
            <span className="font-mono">{app.basePath ?? EMPTY_VALUE}</span>
          </Detail>
          <Detail label="Allowed origins">
            {app.allowedOrigins.length === 0 ? (
              <span className="text-muted-foreground">none (browser beacons refused)</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {app.allowedOrigins.map((origin) => (
                  <Badge key={origin} variant="outline" className="font-mono font-normal">
                    {origin}
                  </Badge>
                ))}
              </span>
            )}
          </Detail>
          <Detail label="Registered">
            <time dateTime={app.createdAt}>{formatDateTime(app.createdAt)}</time>
          </Detail>
        </dl>

        <IntegrationBlock app={app} nowMs={nowMs} nexusUrl={nexusUrl} />

        <div className="-mx-4 -mb-4">
          <DataTable
            caption={`Keys of ${app.displayName}`}
            columns={columns}
            rows={app.keys}
            rowKey={(key) => key.id}
            empty={
              <EmptyState
                className="py-6"
                title="No keys yet"
                description="Issue a secret key for the backend and a publishable key for the browser."
              />
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
