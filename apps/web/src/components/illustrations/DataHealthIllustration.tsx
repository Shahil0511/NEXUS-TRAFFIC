import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Data health: a plug meeting its socket, with a check that the data arrives. */
export function DataHealthIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <path d="M16 72h34" strokeWidth="4" className="stroke-primary/40" />
      <rect x="50" y="56" width="34" height="32" rx="8" className="fill-primary" />
      <path d="M84 64h12M84 80h12" strokeWidth="4" className="stroke-primary" />
      <rect
        x="108"
        y="52"
        width="38"
        height="40"
        rx="9"
        strokeWidth="2"
        className="fill-card stroke-primary/40"
      />
      <path d="M118 64h6M118 80h6" strokeWidth="4" className="stroke-primary/30" />
      <path d="M146 72h40" strokeWidth="4" className="stroke-primary/40" />
      <path d="M96 48l-2-8M102 46l4-7M90 50l-5-6" strokeWidth="2" className="stroke-primary/50" />
      <circle cx="160" cy="32" r="14" className="fill-success" />
      <path d="M153 32l5 5 9-10" strokeWidth="3" className="stroke-card" />
    </IllustrationFrame>
  );
}
