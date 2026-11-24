import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** Problems: a chart card with a failed point and a warning sign raised over it. */
export function ProblemsIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="26"
        y="30"
        width="118"
        height="70"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <path d="M38 44h28" strokeWidth="3" className="stroke-primary/25" />
      <path
        d="M38 82l18-14 14 8 14-22 14 30 14-12 20 4"
        strokeWidth="2.5"
        className="stroke-primary/50"
      />
      <circle cx="98" cy="84" r="4.5" className="fill-chart-5xx" />
      <path
        d="M152 16c2-3 6-3 8 0l24 42c2 3 0 7-4 7h-48c-4 0-6-4-4-7Z"
        className="fill-chart-4xx"
      />
      <path d="M156 32v14" strokeWidth="4" className="stroke-card" />
      <circle cx="156" cy="55" r="2.5" className="fill-card" />
    </IllustrationFrame>
  );
}
