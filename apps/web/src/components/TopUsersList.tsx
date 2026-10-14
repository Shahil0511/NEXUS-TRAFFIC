import type { UserUsageDto } from '@nexus/shared';

import { UserLink } from '@/components/ActorCell';
import { EmptyState } from '@/components/EmptyState';
import { RelativeTime } from '@/components/RelativeTime';
import { CHART_COLORS } from '@/components/charts/chartTheme';
import { formatInteger } from '@/lib/format';

const PERCENT = 100;

export interface TopUsersListProps {
  users: readonly UserUsageDto[];
  /** What `count` counts, e.g. "calls", "views", "failures". */
  unit: string;
  ariaLabel: string;
  /** The current filters, carried by each user link. */
  linkQuery: Readonly<Record<string, string | undefined>>;
  emptyTitle?: string;
}

/**
 * WHY: "who" is the most asked question of every drill-down (who calls this route, who views this
 * page, who uses this tool, who got these errors). One list: each verified user links to their
 * page through the opaque userKey, with a proportional bar, the count and when they were last seen.
 */
export function TopUsersList({
  users,
  unit,
  ariaLabel,
  linkQuery,
  emptyTitle = 'No verified users',
}: TopUsersListProps) {
  if (users.length === 0) {
    return (
      <EmptyState
        className="py-6"
        title={emptyTitle}
        description="Only verified identities (SSO or app-attested) are listed."
      />
    );
  }
  const max = Math.max(1, ...users.map((user) => user.count));
  return (
    <ol className="space-y-3" aria-label={ariaLabel}>
      {users.map((user) => (
        <li key={user.userKey} className="space-y-1.5">
          <div className="flex items-end justify-between gap-3 text-xs">
            <span className="flex min-w-0 flex-col">
              <UserLink userKey={user.userKey} email={user.email} linkQuery={linkQuery} />
              <span className="text-[11px] text-muted-foreground">
                last seen <RelativeTime iso={user.lastSeenAt} />
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular">
              {formatInteger(user.count)}{' '}
              <span className="font-normal text-muted-foreground">{unit}</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(user.count / max) * PERCENT}%`,
                backgroundColor: CHART_COLORS.requests,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
