import { HeroBackdrop, IllustrationFrame, type IllustrationProps } from './IllustrationFrame';

/** People: three avatars side by side, the middle one in front with an "active" dot. */
export function PeopleIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame className={className}>
      <HeroBackdrop />
      <circle cx="58" cy="60" r="22" strokeWidth="1.5" className="fill-card stroke-primary/20" />
      <circle cx="58" cy="54" r="7" className="fill-primary/25" />
      <path d="M46 74c3-6 7-9 12-9s9 3 12 9" strokeWidth="5" className="stroke-primary/25" />
      <circle cx="142" cy="60" r="22" strokeWidth="1.5" className="fill-card stroke-primary/20" />
      <circle cx="142" cy="54" r="7" className="fill-primary/25" />
      <path d="M130 74c3-6 7-9 12-9s9 3 12 9" strokeWidth="5" className="stroke-primary/25" />
      <circle cx="100" cy="60" r="30" strokeWidth="2" className="fill-card stroke-primary/30" />
      <circle cx="100" cy="51" r="10" className="fill-primary" />
      <path d="M84 80c4-9 10-13 16-13s12 4 16 13" strokeWidth="7" className="stroke-primary" />
      <circle cx="122" cy="38" r="6" strokeWidth="2.5" className="fill-success stroke-card" />
    </IllustrationFrame>
  );
}
