import type { UserUsageDto } from '@nexus/shared';
import { Users } from 'lucide-react';

import { AdminsOnlyNote, WHO_ADMINS_ONLY } from '@/components/AdminsOnlyNote';
import { Panel } from '@/components/Panel';
import { TopUsersList } from '@/components/TopUsersList';
import { verifiedPeople } from '@/lib/countPhrase';

export interface WhoUsesItProps {
  /** Distinct verified people in the range (sent to every viewer). */
  count: number;
  /** The people, most first; null when the viewer is not an admin (the API hides them, ADR 0019). */
  users: readonly UserUsageDto[] | null;
  /** What each person's count counts: "views", "uses", "calls". */
  unit: string;
  ariaLabel: string;
  /** The current filters, carried by each person link. */
  linkQuery: Readonly<Record<string, string | undefined>>;
  emptyTitle?: string;
}

/**
 * WHY: every object page (a page, a feature, a request type) answers "who uses it" the same way.
 * Everyone reads the count in a sentence; only dashboard admins get the names (the API sends
 * `users: null` to everyone else, ADR 0019), so a viewer sees the lock note instead of a list.
 * The order is "most first" (ADR 0018) and the description says so as a sort, in neutral words.
 */
export function WhoUsesIt({
  count,
  users,
  unit,
  ariaLabel,
  linkQuery,
  emptyTitle,
}: WhoUsesItProps) {
  const hasList = users !== null && users.length > 0;
  return (
    <Panel
      title="Who uses it"
      icon={Users}
      description={hasList ? `Most ${unit} first` : undefined}
    >
      <div className="space-y-4">
        <p className="text-sm">
          <strong className="font-heading text-lg font-semibold tabular">
            {verifiedPeople(count)}
          </strong>{' '}
          <span className="text-muted-foreground">in this range</span>
        </p>
        {users === null ? (
          <AdminsOnlyNote>{WHO_ADMINS_ONLY}</AdminsOnlyNote>
        ) : (
          <TopUsersList
            users={users}
            unit={unit}
            ariaLabel={ariaLabel}
            linkQuery={linkQuery}
            emptyTitle={emptyTitle}
          />
        )}
      </div>
    </Panel>
  );
}
