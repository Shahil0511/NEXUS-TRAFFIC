import type { Metadata } from 'next';

import { PagesView } from '@/features/pages/PagesView';

export const metadata: Metadata = { title: 'Pages' };

/** PAGES.pages() — @see ../../../features/pages/PagesView.tsx */
export default function PagesPage() {
  return <PagesView />;
}
