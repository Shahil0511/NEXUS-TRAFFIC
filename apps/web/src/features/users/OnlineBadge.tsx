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
  return (
    <Badge variant="success" className="h-auto max-w-full py-0.5 whitespace-normal">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
      />
      <span>
        Online now · in <span className="font-mono">{latest.app}</span>
        {otherApps > 0 ? ` (+${otherApps} more ${otherApps === 1 ? 'app' : 'apps'})` : ''}
        {latest.currentPage ? (
          <>
            {' '}
            · on <span className="font-mono">{latest.currentPage}</span>
          </>
        ) : null}
      </span>
    </Badge>
  );
}
