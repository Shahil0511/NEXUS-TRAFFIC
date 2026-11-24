import { IllustrationFrame, StateBackdrop, type IllustrationProps } from './IllustrationFrame';

/** Not found: a compass looking for the way. */
export function CompassIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 120 80" className={className}>
      <StateBackdrop />
      <circle cx="60" cy="40" r="28" strokeWidth="2" className="fill-card stroke-primary/40" />
      <circle
        cx="60"
        cy="40"
        r="21"
        strokeWidth="1.5"
        strokeDasharray="2 5"
        className="stroke-primary/30"
      />
      <path d="M60 14v4M60 62v4M34 40h4M82 40h4" strokeWidth="2.5" className="stroke-primary/50" />
      <path d="M71 29l-6 15-10-4Z" className="fill-primary" />
      <path d="M49 51l6-15 10 4Z" className="fill-primary/30" />
      <circle cx="60" cy="40" r="3" className="fill-card stroke-primary" strokeWidth="1.5" />
    </IllustrationFrame>
  );
}
