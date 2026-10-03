'use client';

import type { ApiKeyDto, AppDto } from '@nexus/shared';
import { AppWindow, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { AdminOnly } from '@/components/AdminOnly';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { PageHeader } from '@/components/PageHeader';
import { QueryState } from '@/components/QueryState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/me/useMe';

import { AppCard } from './AppCard';
import { AppFormDialog } from './AppFormDialog';
import { CreateKeyDialog } from './CreateKeyDialog';
import { KeyActionDialog, type KeyAction, type KeyActionTarget } from './KeyActionDialog';
import { useAppList } from './useAppList';

const TITLE = 'Apps';
const DESCRIPTION = 'Registered apps and their ingest keys — a new key is shown once, at creation';

export interface AppsViewProps {
  /** `${PUBLIC_ORIGIN}/traffic` (what teams set as NEXUS_URL), or null when unknown. */
  nexusUrl: string | null;
}

/** Which app dialog is open: none, register (no app) or edit (an app). */
type FormState = { open: false } | { open: true; app?: AppDto };

function CardsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1].map((index) => (
        <Card key={index} className="space-y-3 p-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
        </Card>
      ))}
    </div>
  );
}

/** The admin page itself (only rendered for admins). */
function AppsAdmin({ nexusUrl }: AppsViewProps) {
  const apps = useAppList();
  const [form, setForm] = useState<FormState>({ open: false });
  const [keyApp, setKeyApp] = useState<AppDto | null>(null);
  const [keyAction, setKeyAction] = useState<KeyActionTarget | null>(null);
  // "Now" for key status = when the list was fetched (stable across re-renders, fresh on refetch).
  const nowMs = apps.dataUpdatedAt;

  const onEdit = useCallback((app: AppDto) => setForm({ open: true, app }), []);
  const onKeyAction = useCallback(
    (action: KeyAction, app: AppDto, key: ApiKeyDto) => setKeyAction({ action, app, key }),
    [],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <Button size="sm" onClick={() => setForm({ open: true })}>
            <Plus aria-hidden="true" />
            Register app
          </Button>
        }
      />

      <QueryState
        query={apps}
        skeleton={<CardsSkeleton />}
        errorTitle="Could not load the apps"
        isEmpty={apps.data?.length === 0}
        empty={
          <Card>
            <EmptyState
              icon={AppWindow}
              title="No apps registered yet"
              description="Register an app, issue its keys, then send its team the integration guide."
              action={
                <Button size="sm" onClick={() => setForm({ open: true })}>
                  <Plus aria-hidden="true" />
                  Register app
                </Button>
              }
            />
          </Card>
        }
      >
        {() => (
          <div className="space-y-4">
            {apps.data?.map((app) => (
              <AppCard
                key={app.slug}
                app={app}
                nowMs={nowMs}
                nexusUrl={nexusUrl}
                onEdit={onEdit}
                onCreateKey={setKeyApp}
                onKeyAction={onKeyAction}
              />
            ))}
          </div>
        )}
      </QueryState>

      <AppFormDialog
        open={form.open}
        app={form.open ? form.app : undefined}
        onOpenChange={(open) => {
          if (!open) setForm({ open: false });
        }}
      />
      {keyApp ? (
        <CreateKeyDialog
          app={keyApp}
          open
          onOpenChange={(open) => {
            if (!open) setKeyApp(null);
          }}
        />
      ) : null}
      <KeyActionDialog target={keyAction} onClose={() => setKeyAction(null)} />
    </div>
  );
}

/**
 * The Apps page (admins only): register and edit apps, issue keys (shown ONCE), expire (rotation
 * grace) and revoke them. Non-admins see the AdminOnly state; the API enforces the same rule
 * (requireAdmin on every ROUTES.apps mutation).
 */
export function AppsView({ nexusUrl }: AppsViewProps) {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title={TITLE} description={DESCRIPTION} />
        <CardsSkeleton />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={TITLE} />
        <Card>
          <ErrorState error={me.error} onRetry={() => void me.refetch()} />
        </Card>
      </div>
    );
  }
  if (!me.data.isAdmin) {
    return (
      <AdminOnly
        title={TITLE}
        description="Registering apps and issuing, expiring or revoking their ingest keys is limited to dashboard admins."
      />
    );
  }
  return <AppsAdmin nexusUrl={nexusUrl} />;
}
