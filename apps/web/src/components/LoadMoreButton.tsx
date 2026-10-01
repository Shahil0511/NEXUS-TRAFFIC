'use client';

import { ChevronsDown, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface LoadMoreButtonProps {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  /** Rows currently shown, announced next to the button. */
  shown: number;
}

/**
 * WHY: cursor-paged lists grow on demand (no page numbers: keyset cursors cannot jump). The
 * count is announced politely so screen-reader users hear the list grow.
 */
export function LoadMoreButton({ hasMore, loading, onLoadMore, shown }: LoadMoreButtonProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {shown} {shown === 1 ? 'row' : 'rows'}
        {hasMore ? '' : ' · end of list'}
      </p>
      {hasMore ? (
        <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
          {loading ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ChevronsDown aria-hidden="true" />
          )}
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      ) : null}
    </div>
  );
}
