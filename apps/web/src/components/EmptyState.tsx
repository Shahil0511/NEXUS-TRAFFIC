import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

/**
 * WHY: "no data for this window" must look intentional and different from an error or a 0 — and,
 * where there is one, offer the next step (`action`, e.g. WidenRangeButton or a guide link). Keep
 * `description` true whatever the action renders (WidenRangeButton may link to Integration health).
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {/* empty:hidden — an action that renders nothing (e.g. WidenRangeButton on a page without a range) leaves no gap. */}
      {action ? <div className="mt-2 empty:hidden">{action}</div> : null}
    </div>
  );
}
