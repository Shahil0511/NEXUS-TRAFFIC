import type { Metadata } from 'next';

import { GeographyView } from '@/features/geography/GeographyView';

export const metadata: Metadata = { title: 'Geography' };

/** PAGES.geography() — @see ../../../features/geography/GeographyView.tsx */
export default function GeographyPage() {
  return <GeographyView />;
}
