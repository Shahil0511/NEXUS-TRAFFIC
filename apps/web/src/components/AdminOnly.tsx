import { ShieldX } from 'lucide-react';
import type { ReactNode } from 'react';

import { LockIllustration } from '@/components/illustrations';
import { PageHeader } from '@/components/PageHeader';
import { StateArt } from '@/components/StateArt';
import { Card } from '@/components/ui/card';

/** The closing sentence of the Apps page's state (the original use of this component). */
const ASK_AN_ADMIN = 'Ask a Data Nexus admin if your app needs a change or a new key.';

export interface AdminOnlyProps {
  title: string;
  /** What admins do on this page, one sentence. */
  description: string;
  /** The state's heading; defaults to "Admins only". */
  heading?: string;
  /** Printed after the description; null prints nothing. Defaults to the "ask an admin" line. */
  hint?: string | null;
  /** Small line above the page title (breadcrumb / back link). */
  eyebrow?: ReactNode;
  /** One way out, e.g. a link back to a page the viewer may use. */
  action?: ReactNode;
}

/**
 * WHY: the in-shell twin of NoAccess (same icon, tone and wording style) for pages only
 * DASHBOARD_ADMIN_EMAILS may use. The viewer may use the rest of the dashboard, so the shell stays;
 * the API enforces the same rule (requireAdmin → 403), this only avoids a page of failing buttons.
 */
export function AdminOnly({
  title,
  description,
  heading = 'Admins only',
  hint = ASK_AN_ADMIN,
  eyebrow,
  action,
}: AdminOnlyProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} eyebrow={eyebrow} />
      <Card>
        <div role="status" className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <StateArt art={LockIllustration} icon={ShieldX} tone="alert" size="md" />
          <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            {description}
            {hint ? ` ${hint}` : null}
          </p>
          {action ? <div className="mt-1">{action}</div> : null}
        </div>
      </Card>
    </div>
  );
}
