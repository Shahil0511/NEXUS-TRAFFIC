import type { Metadata } from 'next';

import { PrivacyView } from '@/features/privacy/PrivacyView';

export const metadata: Metadata = { title: 'Privacy & access' };

/** PAGES.privacy() — @see ../../../features/privacy/PrivacyView.tsx */
export default function PrivacyPage() {
  return <PrivacyView />;
}
