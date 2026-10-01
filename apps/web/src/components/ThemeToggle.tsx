'use client';

import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const THEME_VALUES = ['light', 'dark', 'system'] as const;
export type ThemeChoice = (typeof THEME_VALUES)[number];

const THEME_OPTIONS: Record<ThemeChoice, { label: string; icon: LucideIcon }> = {
  light: { label: 'Light', icon: Sun },
  dark: { label: 'Dark', icon: Moon },
  system: { label: 'System', icon: Monitor },
};

const subscribeNever = () => () => undefined;

/** True only after hydration — the stored theme is unknown on the server. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * WHY: light / dark / follow-the-OS, remembered per browser by next-themes (class strategy, see
 * AppProviders). The icon shows the resolved theme only after hydration, so the server HTML and
 * the first client render always match.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const Icon = hydrated && resolvedTheme === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Colour theme">
          <Icon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={hydrated ? theme : undefined} onValueChange={setTheme}>
          {THEME_VALUES.map((value) => {
            const option = THEME_OPTIONS[value];
            return (
              <DropdownMenuRadioItem key={value} value={value}>
                <option.icon aria-hidden="true" />
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
