import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Apps: app tiles in a grid, one lifted and highlighted. */
export function AppsIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="52"
        y="22"
        width="40"
        height="40"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/25"
      />
      <rect x="64" y="34" width="16" height="16" rx="4" className="fill-primary/25" />
      <rect
        x="52"
        y="68"
        width="40"
        height="40"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/25"
      />
      <circle cx="72" cy="88" r="8" className="fill-primary/25" />
      <rect
        x="100"
        y="68"
        width="40"
        height="40"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/25"
      />
      <path d="M112 96l8-14 8 14Z" className="fill-primary/25" />
      <rect x="104" y="14" width="44" height="44" rx="11" className="fill-primary" />
      <path d="M116 42l6-8 6 4 8-10" strokeWidth="3" className="stroke-primary-foreground" />
      <path d="M152 76h18M161 67v18" strokeWidth="2" className="stroke-primary/30" />
    </IllustrationFrame>
  );
}
