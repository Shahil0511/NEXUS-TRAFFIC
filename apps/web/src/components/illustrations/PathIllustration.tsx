import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Visits: a dotted path from a start point through two page stops to a finish pin. */
export function PathIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <path
        d="M34 88c20 0 22-36 46-36s22 30 44 30 20-44 42-46"
        strokeWidth="2.5"
        strokeDasharray="2 7"
        className="stroke-primary/60"
      />
      <circle cx="34" cy="88" r="9" strokeWidth="2" className="fill-card stroke-primary" />
      <circle cx="34" cy="88" r="3.5" className="fill-primary" />
      <rect
        x="68"
        y="40"
        width="24"
        height="24"
        rx="6"
        strokeWidth="1.5"
        className="fill-card stroke-primary/30"
      />
      <path d="M74 49h12M74 55h8" strokeWidth="2" className="stroke-primary/40" />
      <rect
        x="112"
        y="70"
        width="24"
        height="24"
        rx="6"
        strokeWidth="1.5"
        className="fill-card stroke-primary/30"
      />
      <path d="M118 79h12M118 85h8" strokeWidth="2" className="stroke-primary/40" />
      <path
        d="M166 12c-8 0-13 6-13 13 0 9 13 21 13 21s13-12 13-21c0-7-5-13-13-13Z"
        className="fill-primary"
      />
      <circle cx="166" cy="25" r="4.5" className="fill-card" />
    </IllustrationFrame>
  );
}
