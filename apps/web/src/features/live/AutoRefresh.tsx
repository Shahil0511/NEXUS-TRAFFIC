'use client';

import { usePathname } from 'next/navigation';

import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { PAGES } from '@/lib/pages';

import { useAutoRefresh } from './useAutoRefresh';

/**
 * Mounted once by the dashboard layout; renders nothing. Off on the Live page, which already
 * streams from its own socket (one socket per tab is enough).
 */
export function AutoRefresh() {
  const pathname = usePathname();
  const { filters } = useGlobalFilters();
  useAutoRefresh({ app: filters.app }, pathname !== PAGES.live());
  return null;
}
