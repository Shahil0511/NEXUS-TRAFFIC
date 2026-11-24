import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** App keys: an app window with a key in front of it. */
export function KeysIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="34"
        y="18"
        width="110"
        height="74"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/25"
      />
      <path d="M34 36h110" strokeWidth="1.5" className="stroke-primary/20" />
      <circle cx="46" cy="27" r="2.5" className="fill-primary/40" />
      <circle cx="55" cy="27" r="2.5" className="fill-primary/25" />
      <circle cx="64" cy="27" r="2.5" className="fill-primary/15" />
      <path d="M48 52h40M48 62h28M48 72h34" strokeWidth="3" className="stroke-primary/20" />
      <circle cx="120" cy="82" r="15" strokeWidth="7" className="fill-card stroke-primary" />
      <path d="M133 74l36-20M158 60l5 8M166 56l4 7" strokeWidth="7" className="stroke-primary" />
    </IllustrationFrame>
  );
}
