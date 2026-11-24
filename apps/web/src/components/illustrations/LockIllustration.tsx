import { IllustrationFrame, StateBackdrop, type IllustrationProps } from './IllustrationFrame';

/** Locked: a padlock in front of a soft shield (admins-only and no-access pages). */
export function LockIllustration({ className }: IllustrationProps) {
  return (
    <IllustrationFrame viewBox="0 0 120 80" className={className}>
      <StateBackdrop />
      <path d="M60 6l26 9v20c0 19-12 31-26 37-14-6-26-18-26-37V15Z" className="fill-primary/15" />
      <path d="M50 38v-7a10 10 0 0 1 20 0v7" strokeWidth="4" className="stroke-primary" />
      <rect x="44" y="36" width="32" height="26" rx="6" className="fill-primary" />
      <circle cx="60" cy="47" r="3.5" className="fill-primary-foreground" />
      <path d="M60 49v6" strokeWidth="3" className="stroke-primary-foreground" />
    </IllustrationFrame>
  );
}
