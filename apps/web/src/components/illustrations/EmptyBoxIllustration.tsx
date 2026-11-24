import { IllustrationFrame, StateBackdrop, type IllustrationProps } from './IllustrationFrame';

/** Empty: an open box with nothing in it and a search lens looking. */
export function EmptyBoxIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 120 80" className={className}>
      <StateBackdrop />
      <path d="M30 34l24-10 24 10-24 10Z" className="fill-primary/15" />
      <path
        d="M30 34v26l24 10 24-10V34L54 44Z"
        strokeWidth="1.5"
        className="fill-card stroke-primary/40"
      />
      <path d="M54 44v26" strokeWidth="1.5" className="stroke-primary/30" />
      <path
        d="M30 34l-8 10 24 10 8-10M78 34l8 10-24 10-8-10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/40"
      />
      <circle cx="88" cy="26" r="9" strokeWidth="3" className="fill-card stroke-primary" />
      <path d="M95 33l7 7" strokeWidth="4" className="stroke-primary" />
    </IllustrationFrame>
  );
}
