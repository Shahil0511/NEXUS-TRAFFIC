'use client';

/**
 * The person page's open tab as a URL param: `?tab=` (summary | daily | devices | activity), and
 * the one day the Daily activity tab shows: `?day=YYYY-MM-DD` (IST).
 *
 * WHY THE URL: the tab and the day must survive Back, a reload and a shared link. An unknown tab
 * falls back to Summary, which is left out of the URL so PAGES.userDetail(userKey) stays short.
 * `day` counts only with `tab=daily` and only when it is a real calendar day (reportingDaySchema);
 * anything else means "all days". The range is the GLOBAL one (useGlobalFilters), not a page-own
 * period; the one-day view ignores it.
 */
import { reportingDaySchema } from '@nexus/shared';
import { createParser, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const USER_DETAIL_TAB_VALUES = ['summary', 'daily', 'devices', 'activity'] as const;
export type UserDetailTab = (typeof USER_DETAIL_TAB_VALUES)[number];

/** `?day=` → the day, or null (all days) when it is not a real `YYYY-MM-DD` day. Pure. */
export function parseReportingDay(value: string): string | null {
  return reportingDaySchema.safeParse(value).success ? value : null;
}

const parseAsReportingDay = createParser({
  parse: parseReportingDay,
  serialize: (day: string) => day,
});

export const userDetailParsers = {
  tab: parseAsStringLiteral(USER_DETAIL_TAB_VALUES).withDefault('summary'),
  day: parseAsReportingDay,
};

export function isUserDetailTab(value: string): value is UserDetailTab {
  return (USER_DETAIL_TAB_VALUES as readonly string[]).includes(value);
}

/**
 * The open tab, read from and written to the URL. Changing the tab drops `day`, so coming back
 * to Daily activity opens the list of days.
 */
export function useUserDetailTab(): { tab: UserDetailTab; setTab: (tab: UserDetailTab) => void } {
  const [raw, setRaw] = useQueryStates(userDetailParsers);
  const setTab = useCallback((tab: UserDetailTab) => void setRaw({ tab, day: null }), [setRaw]);
  return { tab: raw.tab, setTab };
}

/**
 * The day the Daily activity tab shows (null = all days), read from and written to the URL.
 * `setDay(null)` goes back to all days.
 */
export function useUserDetailDay(): { day: string | null; setDay: (day: string | null) => void } {
  const [raw, setRaw] = useQueryStates(userDetailParsers);
  const setDay = useCallback((day: string | null) => void setRaw({ tab: 'daily', day }), [setRaw]);
  return { day: raw.tab === 'daily' ? raw.day : null, setDay };
}
