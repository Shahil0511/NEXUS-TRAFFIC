import Link from 'next/link';

import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

export interface AppChipProps {
  /** Registered app slug (the public app id, ADR 0001). */
  app: string;
  /** The current filters to carry (filterLinkQuery); `app` is dropped — the page IS the app. */
  linkQuery?: Readonly<Record<string, string | undefined>>;
  className?: string;
}

/**
 * WHY: an app name anywhere in the dashboard opens that app's page (PAGES.applicationDetail), so
 * "which app is this?" is always one click away. The slug is a registered id, never ingested text.
 */
export function AppChip({ app, linkQuery = {}, className }: AppChipProps) {
  return (
    <Link
      href={withQuery(PAGES.applicationDetail(app), { ...linkQuery, app: undefined })}
      title={`Open ${app}`}
      className={cn(
        'inline-flex max-w-full items-center rounded-md bg-muted px-1.5 py-0.5 font-mono text-2xs leading-none text-muted-foreground ring-1 ring-border ring-inset transition-colors outline-none hover:bg-accent hover:text-link focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
    >
      <span className="truncate">{app}</span>
    </Link>
  );
}

/** Up to `max` chips, then "+N" (the full list is on the user's page). */
export function AppChipList({
  apps,
  linkQuery,
  max = 3,
}: {
  apps: readonly string[];
  linkQuery?: Readonly<Record<string, string | undefined>>;
  max?: number;
}) {
  const shown = apps.slice(0, max);
  const hidden = apps.length - shown.length;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((app) => (
        <AppChip key={app} app={app} linkQuery={linkQuery} />
      ))}
      {hidden > 0 ? (
        <span className="text-2xs text-muted-foreground" title={apps.slice(max).join(', ')}>
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}
