import type { Metadata } from 'next';

import { UsersView } from '@/features/users/UsersView';

export const metadata: Metadata = { title: 'Users' };

/** PAGES.users() — @see ../../../features/users/UsersView.tsx */
export default function UsersPage() {
  return <UsersView />;
}
