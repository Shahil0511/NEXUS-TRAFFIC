import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** One row of the short list beside the shield. */
function ListRow({ y, length }: { y: number; length: number }) {
  return (
    <>
      <circle cx="44" cy={y} r="4" className="fill-primary/30" />
      <path d={`M54 ${y}h${length}`} strokeWidth="3" className="stroke-primary/20" />
    </>
  );
}

/** Privacy & access: a shield with a check, beside the short list it protects. */
export function ShieldIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <rect
        x="30"
        y="34"
        width="70"
        height="62"
        rx="9"
        strokeWidth="1.5"
        className="fill-card stroke-primary/20"
      />
      <ListRow y={52} length={34} />
      <ListRow y={66} length={26} />
      <ListRow y={80} length={30} />
      <path
        d="M134 14l34 12v26c0 24-16 40-34 46-18-6-34-22-34-46V26Z"
        strokeWidth="2"
        className="fill-primary stroke-primary"
      />
      <path d="M134 24l24 9v19c0 17-11 29-24 34Z" className="fill-primary-foreground/15" />
      <path d="M121 56l9 9 17-19" strokeWidth="4" className="stroke-primary-foreground" />
    </IllustrationFrame>
  );
}
