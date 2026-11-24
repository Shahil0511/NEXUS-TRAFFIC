import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/**
 * Live: a pulse line across a card and a beacon that breathes. The ping runs only under
 * motion-safe (prefers-reduced-motion stops it; globals.css also neutralises animations).
 */
export function PulseIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="24"
        y="28"
        width="132"
        height="70"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <path d="M34 80h112" strokeWidth="1.5" strokeDasharray="3 5" className="stroke-primary/20" />
      <path d="M34 64h30l8-20 12 40 12-52 10 32h40" strokeWidth="3" className="stroke-primary" />
      <circle cx="162" cy="34" r="16" className="fill-primary/10" />
      <circle
        cx="162"
        cy="34"
        r="10"
        className="origin-center fill-primary/20 [transform-box:fill-box] motion-safe:animate-ping"
      />
      <circle cx="162" cy="34" r="6" className="fill-primary" />
      <circle cx="162" cy="34" r="2" className="fill-card" />
    </IllustrationFrame>
  );
}
