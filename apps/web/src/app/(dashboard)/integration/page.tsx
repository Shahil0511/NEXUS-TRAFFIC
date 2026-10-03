import type { Metadata } from 'next';

import { IntegrationView } from '@/features/integration/IntegrationView';

export const metadata: Metadata = { title: 'Integration' };

/** PAGES.integration() — @see ../../../features/integration/IntegrationView.tsx */
export default function IntegrationPage() {
  return <IntegrationView />;
}
