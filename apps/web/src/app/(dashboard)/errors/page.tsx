import type { Metadata } from 'next';

import { ErrorsView } from '@/features/errors/ErrorsView';

export const metadata: Metadata = { title: 'Errors' };

/** PAGES.errors() — @see ../../../features/errors/ErrorsView.tsx */
export default function ErrorsPage() {
  return <ErrorsView />;
}
