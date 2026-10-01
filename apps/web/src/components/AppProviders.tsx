'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

import { createQueryClient } from '@/lib/query/client';

export interface AppProvidersProps {
  /** Per-request CSP nonce from src/proxy.ts, for next-themes' inline no-flash script. */
  nonce: string | undefined;
  children: ReactNode;
}

/**
 * Every client-side context of the dashboard, in one place.
 *
 * WHY: the root layout stays a Server Component; this is the single client boundary that owns
 * the React Query cache (one per tab — `useState(createQueryClient)`), URL state (nuqs), the
 * theme (class strategy, follows the OS until the user picks), toasts and the motion policy
 * (`reducedMotion="user"` honours prefers-reduced-motion everywhere).
 */
export function AppProviders({ nonce, children }: AppProvidersProps) {
  const [queryClient] = useState(createQueryClient);
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <MotionConfig reducedMotion="user">{children}</MotionConfig>
        </NuqsAdapter>
      </QueryClientProvider>
      <Toaster position="bottom-right" richColors closeButton theme="system" />
    </ThemeProvider>
  );
}
