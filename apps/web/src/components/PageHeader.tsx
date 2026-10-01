import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Right-aligned page-level controls (search, filters). */
  actions?: ReactNode;
  /** Small line above the title (breadcrumb / back link). */
  eyebrow?: ReactNode;
}

/** WHY: every page opens the same way — one h1 (landmark for screen readers) and its controls. */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 space-y-1">
        {eyebrow ? <div className="text-xs text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
