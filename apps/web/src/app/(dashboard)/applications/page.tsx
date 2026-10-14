import type { Metadata } from 'next';

import { ApplicationsView } from '@/features/applications/ApplicationsView';

export const metadata: Metadata = { title: 'Applications' };

/** PAGES.applications() — @see ../../../features/applications/ApplicationsView.tsx */
export default function ApplicationsPage() {
  return <ApplicationsView />;
}
