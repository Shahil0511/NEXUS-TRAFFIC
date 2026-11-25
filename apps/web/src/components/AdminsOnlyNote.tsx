import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** The note that replaces a list of people for everyone but dashboard admins (ADR 0019). */
export const WHO_ADMINS_ONLY = 'Only admins see who they are.';

/** The note that replaces a table of single requests for everyone but dashboard admins (ADR 0019). */
export const REQUESTS_ADMINS_ONLY = 'Only admins see single requests.';

/**
 * WHY: names and single requests reach dashboard admins only (the API sends null to everyone
 * else, ADR 0019). Where a list would be, a viewer reads one calm muted line with a lock, so the
 * gap is clearly a rule and not missing data or an error.
 */
export function AdminsOnlyNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn('flex items-center gap-2 text-xs text-muted-foreground', className)}>
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
