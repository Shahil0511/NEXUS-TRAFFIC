import type { Metadata } from 'next';

import { EndpointsView } from '@/features/endpoints/EndpointsView';

export const metadata: Metadata = { title: 'Request types' };

/** PAGES.endpoints() — @see ../../../features/endpoints/EndpointsView.tsx */
export default function EndpointsPage() {
  return <EndpointsView />;
}
