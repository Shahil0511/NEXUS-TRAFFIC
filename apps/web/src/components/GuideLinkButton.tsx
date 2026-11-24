import { BookOpen } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { type GuideChapter, guideHref } from '@/lib/guide';

/**
 * A small outline button that opens one chapter of the public integration guide in a new tab.
 *
 * WHY: business pages say in plain words why a panel is empty ("once the app's team tags its
 * buttons") and leave the SDK terms to the guide; this is the one way they link to it.
 * @see ../lib/guide.ts
 */
export function GuideLinkButton({
  chapter,
  children = 'Integration guide',
}: {
  chapter?: GuideChapter;
  children?: ReactNode;
}) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={guideHref(chapter)} target="_blank" rel="noreferrer noopener">
        <BookOpen aria-hidden="true" />
        {children}
      </a>
    </Button>
  );
}
