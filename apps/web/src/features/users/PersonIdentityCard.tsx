'use client';

import type { UserLatestContextDto, UserProfileDto } from '@nexus/shared';
import type { ReactNode } from 'react';

import { AppChipList } from '@/components/AppChip';
import { CopyButton } from '@/components/CopyButton';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';

import { OnlineBadge } from './OnlineBadge';
import { deviceIconOf, deviceLabel, initialsOf, UNKNOWN_FACT } from './personFacts';

export interface PersonIdentityCardProps {
  userKey: string;
  /** undefined while loading or when the person did nothing in the range. */
  profile: UserProfileDto | undefined;
  /** The profile is still loading (the card shows placeholders). */
  loading: boolean;
  /** undefined while loading; null when the range holds no browser event. */
  latest: UserLatestContextDto | null | undefined;
  /** The devices read failed (the Devices tab shows the error and a retry). */
  latestFailed?: boolean;
  linkQuery: Record<string, string | undefined>;
}

/**
 * WHY: the left column of the person page — who this is and what they last used — stays on
 * screen whatever tab is open (and while a tab loads or the range is empty), so the reader never
 * loses track of whose page this is. "Online now" is not range-bound; everything else is about
 * the selected range.
 */
export function PersonIdentityCard({
  userKey,
  profile,
  loading,
  latest,
  latestFailed = false,
  linkQuery,
}: PersonIdentityCardProps) {
  const email = profile?.summary.email;
  return (
    <aside aria-label="About this person" className="lg:sticky lg:top-4">
      <Card className="gap-4 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 font-heading text-base font-bold text-primary ring-1 ring-primary/20 ring-inset"
          >
            {email ? initialsOf(email) : '?'}
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            {loading ? (
              <Skeleton className="h-5 w-40" />
            ) : email ? (
              <p className="flex items-center gap-1 font-medium break-all">
                {email}
                <CopyButton value={email} label="email" />
              </p>
            ) : (
              <p className="text-muted-foreground">No activity in this range</p>
            )}
            <OnlineBadge userKey={userKey} />
          </div>
        </div>

        {profile ? (
          <dl className="space-y-2 border-t border-border pt-3 text-xs">
            <Fact label="Apps">
              <AppChipList apps={profile.summary.apps} linkQuery={linkQuery} max={6} />
            </Fact>
            <Fact label="First seen">{formatDateTime(profile.firstSeenAt)} IST</Fact>
            <Fact label="Last seen">{formatDateTime(profile.summary.lastSeenAt)} IST</Fact>
            <p className="text-2xs text-muted-foreground">Both in the selected range.</p>
          </dl>
        ) : null}

        <LatestKnown latest={latest} failed={latestFailed} />
      </Card>
    </aside>
  );
}

/** One label / value line of the card. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The facts of the latest browser event of the range ("Latest known"). */
function LatestKnown({
  latest,
  failed,
}: {
  latest: UserLatestContextDto | null | undefined;
  failed: boolean;
}) {
  return (
    <section aria-label="Latest known" className="space-y-2 border-t border-border pt-3 text-xs">
      <h2 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        Latest known
      </h2>
      {failed ? (
        <p className="text-muted-foreground">
          Could not load these facts. The Devices tab can try again.
        </p>
      ) : latest === undefined ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : latest === null ? (
        <p className="text-muted-foreground">
          No browser activity in this range, so there are no browser facts to show.
        </p>
      ) : (
        <>
          <dl className="space-y-2">
            <Fact label="Device">
              <DeviceValue device={latest.device} />
            </Fact>
            <Fact label="Browser">{latest.browser ?? UNKNOWN_FACT}</Fact>
            <Fact label="Operating system">{latest.os ?? UNKNOWN_FACT}</Fact>
            <Fact label="Time zone">{latest.timeZone ?? UNKNOWN_FACT}</Fact>
            <Fact label="Language">{latest.language ?? UNKNOWN_FACT}</Fact>
            <Fact label="App version">
              {latest.appVersion ? (
                <span className="font-mono">{latest.appVersion}</span>
              ) : (
                UNKNOWN_FACT
              )}
            </Fact>
          </dl>
          <p className="text-2xs text-muted-foreground">
            From the latest browser activity, {formatDateTime(latest.seenAt)} IST in{' '}
            <span className="font-mono">{latest.app}</span>.
          </p>
        </>
      )}
    </section>
  );
}

/** A device type with its small icon. */
export function DeviceValue({ device }: { device: string | null }) {
  const Icon = deviceIconOf(device);
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {deviceLabel(device)}
    </span>
  );
}
