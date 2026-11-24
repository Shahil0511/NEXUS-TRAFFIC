import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** One route pill: a verb-coloured dot and a short line. */
function RoutePill({ y, dotClass, length }: { y: number; dotClass: string; length: number }) {
  return (
    <>
      <rect
        x="126"
        y={y - 10}
        width="50"
        height="20"
        rx="10"
        strokeWidth="1.5"
        className="fill-card stroke-primary/30"
      />
      <circle cx="137" cy={y} r="3.5" className={dotClass} />
      <path d={`M146 ${y}h${length}`} strokeWidth="3" className="stroke-primary/25" />
    </>
  );
}

/** Request types: one entry point branching into three routes. */
export function RequestsIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <path
        d="M60 60h26c14 0 14-30 28-30h12M86 60h40M86 60c14 0 14 30 28 30h12"
        strokeWidth="2.5"
        className="stroke-primary/40"
      />
      <circle cx="46" cy="60" r="14" className="fill-primary" />
      <path d="M41 60h10M47 55l5 5-5 5" strokeWidth="2.5" className="stroke-primary-foreground" />
      <RoutePill y={30} dotClass="fill-method-get" length={20} />
      <RoutePill y={60} dotClass="fill-method-post" length={16} />
      <RoutePill y={90} dotClass="fill-method-patch" length={22} />
    </IllustrationFrame>
  );
}
