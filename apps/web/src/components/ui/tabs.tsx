'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

/**
 * WHY: in-page tabs (Devices & places) on Radix Tabs — roving focus, arrow keys, tab / tabpanel
 * roles — styled like the SegmentedControl, so a tab row and a switch look like one family.
 * Inactive panels unmount, so a hidden tab sends no queries.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex h-9 max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 ring-1 ring-border ring-inset',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-input/40 [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('mt-4 outline-none', className)}
      {...props}
    />
  );
}
