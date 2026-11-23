'use client';

/**
 * The person page's open tab as a URL param: `?tab=` (summary | daily | devices | activity).
 *
 * WHY THE URL: the tab must survive Back, a reload and a shared link. An unknown value falls back
 * to Summary, which is left out of the URL so PAGES.userDetail(userKey) stays short. The range is
 * the GLOBAL one (useGlobalFilters), not a page-own period.
 */
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

export const USER_DETAIL_TAB_VALUES = ['summary', 'daily', 'devices', 'activity'] as const;
export type UserDetailTab = (typeof USER_DETAIL_TAB_VALUES)[number];

export const userDetailParsers = {
  tab: parseAsStringLiteral(USER_DETAIL_TAB_VALUES).withDefault('summary'),
};

export function isUserDetailTab(value: string): value is UserDetailTab {
  return (USER_DETAIL_TAB_VALUES as readonly string[]).includes(value);
}

/** The open tab, read from and written to the URL. */
export function useUserDetailTab(): { tab: UserDetailTab; setTab: (tab: UserDetailTab) => void } {
  const [raw, setRaw] = useQueryStates(userDetailParsers);
  const setTab = useCallback((tab: UserDetailTab) => void setRaw({ tab }), [setRaw]);
  return { tab: raw.tab, setTab };
}
