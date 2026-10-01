'use client';

import type { ReactNode } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';

/** The slice of a React Query result this component reads (works for useQuery and useInfiniteQuery). */
export interface QueryStatusLike {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface QueryStateProps {
  query: QueryStatusLike;
  /** Shown while the first response is pending. */
  skeleton: ReactNode;
  /** True when the loaded data has nothing to show. */
  isEmpty?: boolean;
  /** Replaces the default empty state. */
  empty?: ReactNode;
  errorTitle?: string;
  /** Render prop, so the data is only touched once it exists. */
  children: () => ReactNode;
}

/**
 * WHY: every panel has the same four states — loading (skeleton), error (message + request id +
 * retry), empty, data. One component keeps them consistent and keeps views free of branching.
 */
export function QueryState({
  query,
  skeleton,
  isEmpty = false,
  empty,
  errorTitle,
  children,
}: QueryStateProps) {
  if (query.isPending) return <>{skeleton}</>;
  if (query.isError) {
    return (
      <ErrorState error={query.error} title={errorTitle} onRetry={() => void query.refetch()} />
    );
  }
  if (isEmpty) {
    return (
      <>
        {empty ?? (
          <EmptyState
            title="No data in this window"
            description="Try a longer range or another app."
          />
        )}
      </>
    );
  }
  return <>{children()}</>;
}
