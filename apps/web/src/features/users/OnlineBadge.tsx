'use client';

import { Badge } from '@/components/ui/badge';
import { useOnlineNow } from '@/features/live/useOnlineNow';

/**
 * WHY: on a person's page, "are they using an app right now, and where?" answers a support call
 * before it is asked ("I am on the orders page and it hangs"). "Online now · in ebo-sales · on
 * /orders" — their most recent app (the API lists people newest first) and the page template they
 * are on; nothing at all when they are not active in the last 5 minutes. Not app-filtered: being
 * online is a fact about the person. The page is a template, rendered as text (never a link).
 */
export function OnlineBadge({ userKey }: { userKey: string }) {
  const online = useOnlineNow({ userKey });
  const rows = online.data?.users.filter((row) => row.userKey === userKey) ?? [];
  const latest = rows[0];
  if (!latest) return null;
  const otherApps = new Set(rows.map((row) => row.app)).size - 1;
  const more = otherAppsLabel(otherApps);
  return (
    <Badge variant="success" className="h-auto max-w-full py-0.5 whitespace-normal">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
      />
      {/* One sentence for screen readers; the visual parts below are spaced by the flex gap. */}
      <span className="sr-only">{onlineSentence(latest.app, otherApps, latest.currentPage)}</span>
      <span aria-hidden="true" className="inline-flex min-w-0 flex-wrap items-center gap-x-1">
        <span>Online now</span>
        <span>·</span>
        <span>in</span>
        <span className="font-mono break-all">{latest.app}</span>
        {more ? <span>{more}</span> : null}
        {latest.currentPage ? (
          <>
            <span>·</span>
            <span>on</span>
            <span className="font-mono break-all">{latest.currentPage}</span>
          </>
        ) : null}
      </span>
    </Badge>
  );
}

/** "(+1 more app)", "(+2 more apps)"; '' when the person is in one app only. Pure. */
export function otherAppsLabel(otherApps: number): string {
  if (otherApps <= 0) return '';
  return `(+${otherApps} more ${otherApps === 1 ? 'app' : 'apps'})`;
}

/**
 * The whole badge as one sentence — "Online now · in ebo-sales (+1 more app) · on /orders" —
 * so assistive technology reads it with every space and the app name in place. Pure.
 */
export function onlineSentence(app: string, otherApps: number, currentPage: string | null): string {
  const more = otherAppsLabel(otherApps);
  const where = more ? `${app} ${more}` : app;
  return currentPage ? `Online now · in ${where} · on ${currentPage}` : `Online now · in ${where}`;
}
