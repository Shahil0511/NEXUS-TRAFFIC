import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Overview: a dashboard card with bars, a trend line and a small ring chart. */
export function ChartsIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="32"
        y="22"
        width="118"
        height="78"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <path d="M44 36h30" strokeWidth="3" className="stroke-primary/30" />
      <rect x="46" y="70" width="10" height="20" rx="2.5" className="fill-primary/20" />
      <rect x="62" y="60" width="10" height="30" rx="2.5" className="fill-primary/30" />
      <rect x="78" y="66" width="10" height="24" rx="2.5" className="fill-primary/20" />
      <rect x="94" y="52" width="10" height="38" rx="2.5" className="fill-chart-requests/70" />
      <rect x="110" y="58" width="10" height="32" rx="2.5" className="fill-primary/30" />
      <rect x="126" y="46" width="10" height="44" rx="2.5" className="fill-primary/20" />
      <path d="M46 62l18-10 16 6 18-16 16 8 22-14" strokeWidth="2.5" className="stroke-primary" />
      <rect
        x="132"
        y="12"
        width="48"
        height="40"
        rx="9"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <circle cx="156" cy="32" r="11" strokeWidth="5" className="stroke-primary/15" />
      <circle
        cx="156"
        cy="32"
        r="11"
        strokeWidth="5"
        strokeDasharray="48 70"
        transform="rotate(-90 156 32)"
        className="stroke-primary"
      />
    </IllustrationFrame>
  );
}
