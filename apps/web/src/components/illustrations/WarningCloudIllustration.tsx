import { IllustrationFrame, StateBackdrop, type IllustrationProps } from './IllustrationFrame';

/** Error: a cloud with a warning mark and a broken link under it. */
export function WarningCloudIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 120 80" className={className}>
      <StateBackdrop />
      <path
        d="M38 58h44c8 0 14-6 14-13s-6-13-13-13c-2-9-10-15-19-15-10 0-18 7-19 16-7 1-12 6-12 13s6 12 5 12Z"
        strokeWidth="1.5"
        className="fill-card stroke-destructive/50"
      />
      <path d="M60 30v12" strokeWidth="4" className="stroke-destructive" />
      <circle cx="60" cy="50" r="2.5" className="fill-destructive" />
      <path d="M50 66h6M64 66h6" strokeWidth="3" className="stroke-destructive/40" />
      <path d="M58 63l4 6" strokeWidth="2" className="stroke-destructive/40" />
    </IllustrationFrame>
  );
}
