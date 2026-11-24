import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Devices & places: a globe behind a desktop screen and a phone. */
export function DevicesIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <circle cx="142" cy="42" r="28" strokeWidth="1.5" className="fill-card stroke-primary/30" />
      <ellipse cx="142" cy="42" rx="12" ry="28" strokeWidth="1.5" className="stroke-primary/30" />
      <path d="M114 42h56M118 28h48M118 56h48" strokeWidth="1.5" className="stroke-primary/25" />
      <rect
        x="30"
        y="32"
        width="92"
        height="60"
        rx="8"
        strokeWidth="2"
        className="fill-card stroke-primary/40"
      />
      <rect x="38" y="40" width="76" height="42" rx="4" className="fill-primary/10" />
      <path d="M46 72l14-12 10 6 16-14 20 12" strokeWidth="2.5" className="stroke-primary" />
      <path d="M64 102h24M76 92v10" strokeWidth="3" className="stroke-primary/40" />
      <rect
        x="128"
        y="62"
        width="30"
        height="46"
        rx="6"
        strokeWidth="2"
        className="fill-card stroke-primary"
      />
      <rect x="133" y="68" width="20" height="30" rx="2" className="fill-primary/15" />
      <path d="M139 103h8" strokeWidth="2" className="stroke-primary/50" />
    </IllustrationFrame>
  );
}
