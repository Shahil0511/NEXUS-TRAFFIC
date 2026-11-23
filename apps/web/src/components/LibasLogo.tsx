import { PUBLIC_BASE_PATH } from '@nexus/shared';

import { cn } from '@/lib/utils';

/** The Libas wordmark (white on transparent), served from public/ under the basePath. */
const LOGO_URL = `url(${PUBLIC_BASE_PATH}/brand/libas-logo.png)`;

/**
 * WHY: the Libas wordmark, drawn as a CSS mask filled with `currentColor`, the same way the Libas
 * Leaderboard draws it. One image file then takes the theme's colour (plum on the white sidebar,
 * white on the dark one) with no second asset. Decorative: the link around it carries the name.
 */
export function LibasLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block shrink-0 bg-current', className)}
      style={{
        maskImage: LOGO_URL,
        maskPosition: 'center',
        maskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskImage: LOGO_URL,
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
      }}
    />
  );
}
