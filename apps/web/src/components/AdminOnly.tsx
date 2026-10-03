import { ShieldX } from 'lucide-react';

import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';

export interface AdminOnlyProps {
  title: string;
  /** What admins do on this page, one sentence. */
  description: string;
}

/**
 * WHY: the in-shell twin of NoAccess (same icon, tone and wording style) for pages only
 * DASHBOARD_ADMIN_EMAILS may use. The viewer may use the rest of the dashboard, so the shell stays;
 * the API enforces the same rule (requireAdmin → 403), this only avoids a page of failing buttons.
 */
export function AdminOnly({ title, description }: AdminOnlyProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} />
      <Card>
        <div role="status" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <ShieldX className="size-6" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold tracking-tight">Admins only</h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {description} Ask a Data Nexus admin if your app needs a change or a new key.
          </p>
        </div>
      </Card>
    </div>
  );
}
