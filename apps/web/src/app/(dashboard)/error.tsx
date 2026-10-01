'use client';

import { ErrorState } from '@/components/ErrorState';
import { Card } from '@/components/ui/card';

/**
 * WHY: a render error inside one page keeps the shell (navigation, filters) usable and offers a
 * retry; Next shows this boundary instead of a blank screen.
 */
export default function DashboardError({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <Card>
      <ErrorState error={error} title="This page failed to render" onRetry={retry} />
    </Card>
  );
}
