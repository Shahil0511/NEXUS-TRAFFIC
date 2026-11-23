'use client';

/**
 * The Devices & places page state as URL params: `?tab=` (devices | places) and `?share=`
 * (pageViews | requests).
 *
 * WHY THE URL: the tab and the "Show share of" choice must survive Back, a reload and a shared
 * link (a `useState` reset on Back). Unknown values fall back to the defaults, which are left out
 * of the URL so the plain /devices link stays short.
 */
import { parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useCallback } from 'react';

import { SHARE_OF_VALUES, type ShareOf } from './shareOf';

export const DEVICES_TAB_VALUES = ['devices', 'places'] as const;
export type DevicesTab = (typeof DEVICES_TAB_VALUES)[number];

export const devicesParsers = {
  tab: parseAsStringLiteral(DEVICES_TAB_VALUES).withDefault('devices'),
  share: parseAsStringLiteral(SHARE_OF_VALUES).withDefault('pageViews'),
};

export interface DevicesParams {
  tab: DevicesTab;
  share: ShareOf;
  setTab: (tab: DevicesTab) => void;
  setShare: (share: ShareOf) => void;
}

/** The page's tab and share-of choice, read from and written to the URL. */
export function useDevicesParams(): DevicesParams {
  const [raw, setRaw] = useQueryStates(devicesParsers);
  const setTab = useCallback((tab: DevicesTab) => void setRaw({ tab }), [setRaw]);
  const setShare = useCallback((share: ShareOf) => void setRaw({ share }), [setRaw]);
  return { tab: raw.tab, share: raw.share, setTab, setShare };
}
