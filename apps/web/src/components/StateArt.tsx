import type { LucideIcon } from 'lucide-react';

import type { Illustration } from '@/components/illustrations';
import { cn } from '@/lib/utils';

/** Badge colours: calm (empty, not found, too long) or alarming (error, no access). */
const TONE_CLASS = {
  calm: 'bg-accent text-accent-foreground',
  // Opaque card fill: a translucent tint would show the scene through the badge.
  alert: 'bg-card text-destructive',
} as const;

export interface StateArtProps {
  /** The scene (an empty box, a warning cloud, a lock, a compass). */
  art: Illustration;
  /** What this state is about, as a small badge on the scene's corner. */
  icon: LucideIcon;
  tone?: keyof typeof TONE_CLASS;
  /** `md` on full-page states (no access, not found, admins only); `sm` inside panels. */
  size?: 'sm' | 'md';
}

/**
 * WHY: every "nothing here / something went wrong / not for you" state opens with the same small
 * scene plus a badge with the state's own icon (an Eye for an empty log, a Network for no
 * location), so a state looks intentional and keeps its specific meaning. Decorative only: the
 * heading under it says what happened.
 */
export function StateArt({ art: Art, icon: Icon, tone = 'calm', size = 'sm' }: StateArtProps) {
  return (
    <span aria-hidden="true" data-slot="state-art" className="relative mx-auto inline-flex">
      <Art className={size === 'md' ? 'w-36' : 'w-24'} />
      <span
        className={cn(
          'absolute right-0 bottom-0 flex items-center justify-center rounded-lg shadow-raised ring-2 ring-card',
          size === 'md' ? 'size-9' : 'size-7',
          TONE_CLASS[tone],
        )}
      >
        <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
      </span>
    </span>
  );
}
