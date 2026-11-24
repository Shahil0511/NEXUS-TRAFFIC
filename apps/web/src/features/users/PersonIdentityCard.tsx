'use client';

import type { UserLatestContextDto, UserProfileDto } from '@nexus/shared';
import type { ReactNode } from 'react';

import { AppChipList } from '@/components/AppChip';
import { CopyButton } from '@/components/CopyButton';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatOsName, withUnit } from '@/lib/format';
import { cn } from '@/lib/utils';

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
  /**
   * The profile read failed (not a no-activity 404: that passes latest null). The page shows the
   * error and its retry in place of the tabs.
   */
  latestFailed?: boolean;
  linkQuery: Record<string, string | undefined>;
}

/**
 * WHY: who this is and what they last used stays on screen whatever tab is open (and while a tab
 * loads or the range is empty), so the reader never loses track of whose page this is. On very
 * wide screens (2xl) it is a sticky left column; below that it is a band ABOVE the tabs with its
 * three parts side by side, so the tab tables get the full width. It sticks below the sticky
 * top bar (`top-below-topbar` = the bar's height token plus a gap). "Online now" is not
 * range-bound; everything else is about the selected range.
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
    <aside aria-label="About this person" className="min-w-0 2xl:sticky 2xl:top-below-topbar">
      <Card className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
        <div className="flex min-w-0 items-start gap-3">
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
          <dl className={cn('space-y-2 text-xs', SECOND_PART)}>
            <Fact label="Apps">
              <AppChipList apps={profile.summary.apps} linkQuery={linkQuery} max={6} />
            </Fact>
            <Fact label="First activity">
              {withUnit(formatDateTime(profile.firstSeenAt), 'IST')}
            </Fact>
            <Fact label="Last activity">
              {withUnit(formatDateTime(profile.summary.lastSeenAt), 'IST')}
            </Fact>
            <p className="text-2xs text-muted-foreground">Both in the selected range.</p>
          </dl>
        ) : null}

        <LatestKnown latest={latest} failed={latestFailed} />
      </Card>
    </aside>
  );
}

/**
 * Separators between the card's parts: a top rule while they stack (phone, and the 2xl side
 * column), a left rule while they sit side by side (the band above the tabs). The second part
 * sits beside the first from md; the third joins the row from xl.
 */
const SECOND_PART =
  'border-t border-border pt-3 md:border-t-0 md:border-l md:pt-0 md:pl-4 2xl:border-t 2xl:border-l-0 2xl:pt-3 2xl:pl-0';
const THIRD_PART =
  'border-t border-border pt-3 md:col-span-2 xl:col-span-1 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-4 2xl:border-t 2xl:border-l-0 2xl:pt-3 2xl:pl-0';

/**
 * "From the latest browser activity, 1 Oct, 14:05:09 IST in ebo-sales." — one plain sentence, so
 * the app name is never lost to assistive technology. Pure.
 */
export function latestSourceLine(latest: Pick<UserLatestContextDto, 'seenAt' | 'app'>): string {
  return `From the latest browser activity, ${withUnit(formatDateTime(latest.seenAt), 'IST')} in ${latest.app}.`;
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
    <section aria-label="Latest known" className={cn('min-w-0 space-y-2 text-xs', THIRD_PART)}>
      <h2 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
        Latest known
      </h2>
      {failed ? (
        <p className="text-muted-foreground">Could not load these facts.</p>
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
            <Fact label="Operating system">
              {latest.os ? formatOsName(latest.os) : UNKNOWN_FACT}
            </Fact>
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
          <p className="text-2xs text-muted-foreground">{latestSourceLine(latest)}</p>
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
