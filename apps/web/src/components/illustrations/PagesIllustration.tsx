import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Pages & features: two stacked pages and a pointer clicking a button on the front one. */
export function PagesIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="70"
        y="10"
        width="76"
        height="84"
        rx="9"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <rect
        x="50"
        y="22"
        width="82"
        height="88"
        rx="9"
        strokeWidth="2"
        className="fill-card stroke-primary/35"
      />
      <rect x="60" y="32" width="62" height="18" rx="4" className="fill-primary/10" />
      <path d="M60 60h50M60 68h40M60 76h46" strokeWidth="3" className="stroke-primary/20" />
      <rect x="60" y="88" width="34" height="12" rx="6" className="fill-primary" />
      <path
        d="M96 92l22 9-9 3 6 10-5 3-6-10-7 6Z"
        strokeWidth="1.5"
        className="fill-card stroke-primary"
      />
      <path d="M100 84l-3-5M108 84l2-6M114 89l5-3" strokeWidth="2" className="stroke-primary/50" />
    </IllustrationFrame>
  );
}
