/**
 * Render a component inside the same providers the app uses (React Query + nuqs), minus the
 * browser-only ones (theme, toasts, motion).
 *
 * WHY: each test gets a fresh QueryClient (no cache bleed between tests) with retries OFF, so an
 * error state appears immediately instead of after the production back-off.
 */
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import type { ReactElement } from 'react';

import { createQueryClient } from '@/lib/query/client';

export interface RenderOptions {
  /** Initial URL query, e.g. `?range=7d`. */
  searchParams?: string;
  onUrlUpdate?: (event: UrlUpdateEvent) => void;
}

export function createTestQueryClient(): QueryClient {
  const client = createQueryClient(() => undefined);
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } });
  return client;
}

export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = createTestQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <NuqsTestingAdapter
        searchParams={options.searchParams}
        onUrlUpdate={options.onUrlUpdate}
        hasMemory
      >
        {ui}
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
