import type { Metadata } from 'next';

import { OverviewView } from '@/features/overview/OverviewView';

export const metadata: Metadata = { title: 'Overview' };

/** PAGES.overview() — @see ../../features/overview/OverviewView.tsx */
export default function OverviewPage() {
  return <OverviewView />;
}
