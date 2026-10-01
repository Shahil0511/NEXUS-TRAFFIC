'use client';

import { AppWindow } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppList } from '@/features/apps/useAppList';
import { cn } from '@/lib/utils';

import { useGlobalFilters } from './useGlobalFilters';

/**
 * Radix Select forbids an empty-string item value, so "all apps" needs a sentinel. It can never
 * collide with a real slug: APP_SLUG_PATTERN does not allow underscores at the start.
 */
export const ALL_APPS_VALUE = '__all__';

/**
 * WHY: the global app filter. Options come from api.apps.list (slugs are the public app ids,
 * ADR 0001); the choice lands in the URL (`?app=`) through useGlobalFilters. While the list loads
 * or fails, the control still shows the current selection and "All apps" keeps working.
 */
export function AppSelect({ className }: { className?: string }) {
  const { filters, setApp } = useGlobalFilters();
  const apps = useAppList();
  const current = filters.app ?? ALL_APPS_VALUE;
  const known = apps.data?.some((app) => app.slug === filters.app) ?? false;

  return (
    <Select
      value={current}
      onValueChange={(value) => setApp(value === ALL_APPS_VALUE ? null : value)}
    >
      <SelectTrigger aria-label="App filter" className={cn('w-48', className)}>
        <AppWindow className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <SelectValue placeholder="All apps" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_APPS_VALUE}>All apps</SelectItem>
        {apps.data && apps.data.length > 0 ? <SelectSeparator /> : null}
        {filters.app && !known ? <SelectItem value={filters.app}>{filters.app}</SelectItem> : null}
        {apps.data?.map((app) => (
          <SelectItem key={app.slug} value={app.slug}>
            <span className="flex items-center gap-2">
              <span className="truncate">{app.displayName}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{app.slug}</span>
            </span>
          </SelectItem>
        ))}
        {apps.isError ? (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            Could not load the app list.
          </p>
        ) : null}
      </SelectContent>
    </Select>
  );
}
