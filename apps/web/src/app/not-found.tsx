import { Compass } from 'lucide-react';
import Link from 'next/link';

import { CompassIllustration } from '@/components/illustrations';
import { StateArt } from '@/components/StateArt';
import { Button } from '@/components/ui/button';
import { PAGES } from '@/lib/pages';

/** WHY: unknown URLs (and invalid endpoint ids) get a calm page with a way back, not a stack. */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-4 text-center">
        <StateArt art={CompassIllustration} icon={Compass} size="md" />
        <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This page does not exist in the Traffic dashboard.
        </p>
        <Button asChild>
          <Link href={PAGES.overview()}>Go to the overview</Link>
        </Button>
      </div>
    </main>
  );
}
