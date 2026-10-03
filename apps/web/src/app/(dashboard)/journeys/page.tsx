import type { Metadata } from 'next';

import { JourneysView } from '@/features/journeys/JourneysView';

export const metadata: Metadata = { title: 'Journeys' };

/** PAGES.journeys() — @see ../../../features/journeys/JourneysView.tsx */
export default function JourneysPage() {
  return <JourneysView />;
}
