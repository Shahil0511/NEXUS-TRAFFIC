import type { Metadata } from 'next';

import { DevicesView } from '@/features/devices/DevicesView';

export const metadata: Metadata = { title: 'Devices & places' };

/** PAGES.devices() — @see ../../../features/devices/DevicesView.tsx */
export default function DevicesPage() {
  return <DevicesView />;
}
