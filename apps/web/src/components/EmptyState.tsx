import { Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmptyBoxIllustration } from '@/components/illustrations';
import { StateArt } from '@/components/StateArt';
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
 * `description` true whatever the action renders (WidenRangeButton may link to Data health).
 * The scene is the empty box; `icon` is its badge (@see ./StateArt.tsx).
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
      <StateArt art={EmptyBoxIllustration} icon={Icon} />
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {/* empty:hidden — an action that renders nothing (e.g. WidenRangeButton on a page without a range) leaves no gap. */}
      {action ? <div className="mt-2 empty:hidden">{action}</div> : null}
    </div>
  );
}
