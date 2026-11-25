'use client';

import type { TimeWindowQuery } from '@nexus/shared';

import { UserDayDetail } from './UserDayDetail';
import { UserDaysOverview } from './UserDaysOverview';
import { useUserDetailDay } from './userDetailParams';

/**
 * WHY a thin switch: the person page's "Daily activity" tab (`?tab=daily`) shows every day of the
 * global range (UserDaysOverview), or ONE day when the URL names it (`&day=YYYY-MM-DD`,
 * UserDayDetail). The choice lives in the URL, so Back, a reload and a shared link keep it, and
 * the page itself does not know which one is open.
 */
export function UserDailyActivityTab({
  userKey,
  filters,
}: {
  userKey: string;
  filters: TimeWindowQuery;
}) {
  const { day } = useUserDetailDay();
  if (day !== null) return <UserDayDetail userKey={userKey} day={day} filters={filters} />;
  return <UserDaysOverview userKey={userKey} filters={filters} />;
}
