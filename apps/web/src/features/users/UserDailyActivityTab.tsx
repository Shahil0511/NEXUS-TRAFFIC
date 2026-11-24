'use client';

import type { TimeWindowQuery } from '@nexus/shared';

import { UserDaysOverview } from './UserDaysOverview';

/**
 * WHY a thin entry: the person page's "Daily activity" tab (`?tab=daily`). Today it shows every
 * day of the global range (UserDaysOverview); it is the one place that will choose between the
 * list of days and a single day, so the page itself does not change when that view is added.
 */
export function UserDailyActivityTab({
  userKey,
  filters,
}: {
  userKey: string;
  filters: TimeWindowQuery;
}) {
  return <UserDaysOverview userKey={userKey} filters={filters} />;
}
