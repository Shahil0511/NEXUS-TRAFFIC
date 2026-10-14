'use client';

import {
  ACTIVE_USER_WINDOW_MS,
  type OnlineAppDto,
  type OnlineNowDto,
  type OnlineUserDto,
} from '@nexus/shared';
import { Check, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ActivityEventSummary, ActivityKindBadge } from '@/components/ActivityEvent';
import { UserLink } from '@/components/ActorCell';
import { AppChip } from '@/components/AppChip';
import { EmptyState } from '@/components/EmptyState';
import { ENTITY_LINK_CLASS } from '@/components/EntityLinks';
import { InfoTip } from '@/components/InfoTip';
import { ListSkeleton, Panel } from '@/components/Panel';
import { QueryState } from '@/components/QueryState';
import { RelativeTime } from '@/components/RelativeTime';
import { useAppList } from '@/features/apps/useAppList';
import { useGlobalFilters } from '@/features/filters/useGlobalFilters';
import { formatInteger } from '@/lib/format';
import { metricInfo } from '@/lib/metricCopy';
import { PAGES, withQuery } from '@/lib/pages';
import { cn } from '@/lib/utils';

import { ONLINE_NOW_REFRESH_MS, useOnlineNow } from './useOnlineNow';

type LinkQuery = Readonly<Record<string, string | undefined>>;

const WINDOW_MINUTES = ACTIVE_USER_WINDOW_MS / 60_000;
const REFRESH_SECONDS = ONLINE_NOW_REFRESH_MS / 1000;
/** How often the "N s ago" texts are re-rendered between two polls. */
const CLOCK_TICK_MS = 5_000;
const INITIALS = 2;

/**
 * "Who's online now" on the Live page: how many people are active per app and, for each verified
 * person, the app, the page they are on, what they did last, when, and a link to their session.
 *
 * WHY TWO QUERIES: the app chips always show EVERY app (so another app is one click away), while
 * the count and the people follow the global app filter. Without a filter both are the same key,
 * so React Query sends ONE request. Clicking a chip sets (or clears) the global app filter, which
 * also scopes the rest of the Live page. Only the count is a live region — announcing every row
 * every 15 s would drown a screen reader.
 */
export function OnlineNowPanel() {
  const { filters, setApp } = useGlobalFilters();
  const app = filters.app;
  const everyApp = useOnlineNow({});
  const scoped = useOnlineNow(app ? { app } : {});
  const names = useAppNames();
  const linkQuery = useMemo<LinkQuery>(() => ({ app }), [app]);
  useClockTick(CLOCK_TICK_MS);
  const data = scoped.data;
  // Placeholder rows (the previous app's, while the new app loads) have no fetch time of their own
  // (dataUpdatedAt is 0): say nothing rather than "20 000 d ago".
  const updatedAt =
    data && !scoped.isPlaceholderData && scoped.dataUpdatedAt > 0
      ? new Date(scoped.dataUpdatedAt).toISOString()
      : null;

  return (
    <Panel
      title="Who's online now"
      description={
        <>
          People active in the last {WINDOW_MINUTES} minutes · refreshed every {REFRESH_SECONDS} s
          {updatedAt ? (
            <>
              {' '}
              · updated <RelativeTime iso={updatedAt} />
            </>
          ) : null}
        </>
      }
      aside={<OnlineCount data={data} />}
    >
      <div className="space-y-4">
        {everyApp.data && everyApp.data.apps.length > 0 ? (
          <OnlineAppFilter
            apps={everyApp.data.apps}
            selected={app}
            names={names}
            onSelect={(slug) => setApp(slug === app ? null : slug)}
          />
        ) : null}
        <QueryState
          query={scoped}
          skeleton={<ListSkeleton rows={4} />}
          errorTitle="Could not load who is online"
          isEmpty={data ? data.users.length === 0 : false}
          empty={<NobodyOnline anonymous={data ? totalsOf(data.apps).anonymous : 0} />}
        >
          {() => (
            <div
              aria-busy={scoped.isPlaceholderData}
              className={cn(scoped.isPlaceholderData && 'opacity-60')}
            >
              <OnlinePeopleList data={data!} linkQuery={linkQuery} />
            </div>
          )}
        </QueryState>
      </div>
    </Panel>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Re-render every `ms` so relative times ("30 s ago") keep moving between polls. */
function useClockTick(ms: number): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
}

/** slug → display name from the registered apps (cached by the top bar's App filter). */
function useAppNames(): ReadonlyMap<string, string> {
  const apps = useAppList();
  return useMemo(
    () => new Map((apps.data ?? []).map((item) => [item.slug, item.displayName])),
    [apps.data],
  );
}

/** Verified + anonymous people over the apps of one answer. */
export function totalsOf(apps: readonly OnlineAppDto[]): { users: number; anonymous: number } {
  return apps.reduce(
    (sum, item) => ({ users: sum.users + item.users, anonymous: sum.anonymous + item.anonymous }),
    { users: 0, anonymous: 0 },
  );
}

/** "amit.panchal@…" → "AP", "buyer@…" → "BU" (the avatar of a row; decorative). */
export function initialsOf(email: string): string {
  const local = email.split('@')[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const letters =
    parts.length >= INITIALS ? parts.map((part) => part[0]).join('') : (parts[0] ?? local);
  return letters.slice(0, INITIALS).toUpperCase();
}

function plural(count: number, one: string, many: string): string {
  return `${formatInteger(count)} ${count === 1 ? one : many}`;
}

// ─── Header count ────────────────────────────────────────────────────────────

/** THE live region of the panel: only the number of people is announced when it changes. */
function OnlineCount({ data }: { data: OnlineNowDto | undefined }) {
  const totals = data ? totalsOf(data.apps) : null;
  return (
    <div className="flex items-center gap-2">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm">
        {totals ? (
          <>
            <span className="text-lg font-semibold tabular">
              {formatInteger(totals.users + totals.anonymous)}
            </span>{' '}
            online
            <span className="text-2xs text-muted-foreground">
              {' '}
              ({formatInteger(totals.users)} signed in · {formatInteger(totals.anonymous)}{' '}
              anonymous)
            </span>
          </>
        ) : null}
      </p>
      <InfoTip label="Online now" text={metricInfo('onlineNow')} />
    </div>
  );
}

// ─── App chips ───────────────────────────────────────────────────────────────

/** "EBO Sales · 4 users · 2 anonymous" per app; a toggle of the global app filter. */
function OnlineAppFilter({
  apps,
  selected,
  names,
  onSelect,
}: {
  apps: readonly OnlineAppDto[];
  selected: string | undefined;
  names: ReadonlyMap<string, string>;
  onSelect: (app: string) => void;
}) {
  return (
    <div role="group" aria-label="Show one app" className="flex flex-wrap gap-2">
      {apps.map((item) => {
        const pressed = item.app === selected;
        return (
          <button
            key={item.app}
            type="button"
            aria-pressed={pressed}
            onClick={() => onSelect(item.app)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ring-1 ring-border ring-inset outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60',
              pressed && 'bg-muted font-medium ring-ring/60',
            )}
          >
            {pressed ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
            )}
            <span>{names.get(item.app) ?? item.app}</span>
            <span className="text-muted-foreground">
              · {plural(item.users, 'user', 'users')}
              {item.anonymous > 0 ? ` · ${formatInteger(item.anonymous)} anonymous` : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────

function NobodyOnline({ anonymous }: { anonymous: number }) {
  if (anonymous > 0) {
    return (
      <EmptyState
        className="py-6"
        icon={UsersRound}
        title="No signed-in people right now"
        description={`${plural(anonymous, 'anonymous browser session is', 'anonymous browser sessions are')} active. Only verified identities are listed by name.`}
      />
    );
  }
  return (
    <EmptyState
      className="py-6"
      icon={UsersRound}
      title="Nobody is active right now"
      description={`This list covers the last ${WINDOW_MINUTES} minutes and refreshes every ${REFRESH_SECONDS} s.`}
    />
  );
}

function OnlinePeopleList({ data, linkQuery }: { data: OnlineNowDto; linkQuery: LinkQuery }) {
  const verified = totalsOf(data.apps).users;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border" aria-label="People online now">
        {data.users.map((person) => (
          <OnlinePersonRow
            key={`${person.userKey}:${person.app}`}
            person={person}
            linkQuery={linkQuery}
          />
        ))}
      </ul>
      {verified > data.users.length ? (
        <p className="text-2xs text-muted-foreground">
          Showing the {formatInteger(data.users.length)} most recently active of{' '}
          {formatInteger(verified)} signed-in people.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One person in one app. Paths are templates (text, never links — 05-conventions §5); the page
 * cannot be a PageLink because the answer carries no pageId. An API call links to its route
 * through the OPAQUE endpointId (ActivityEventSummary), a session through its uuid.
 */
function OnlinePersonRow({ person, linkQuery }: { person: OnlineUserDto; linkQuery: LinkQuery }) {
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 py-2.5">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground"
      >
        {initialsOf(person.email)}
      </span>
      <div className="min-w-0 flex-1 basis-64 space-y-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <UserLink userKey={person.userKey} email={person.email} linkQuery={linkQuery} />
          <AppChip app={person.app} linkQuery={linkQuery} />
          {person.currentPage ? (
            <span className="flex min-w-0 items-center gap-1 text-xs">
              <span className="text-muted-foreground">on</span>
              <span className="truncate font-mono" title={person.currentPage}>
                {person.currentPage}
              </span>
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="sr-only">Last action:</span>
          <ActivityKindBadge kind={person.lastEvent.kind} />
          <ActivityEventSummary
            event={{ ...person.lastEvent, durationMs: null, visibleMs: null, name: null }}
            linkQuery={linkQuery}
          />
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-2xs text-muted-foreground">
        <span>
          active <RelativeTime iso={person.lastSeenAt} />
        </span>
        <span className="tabular">{plural(person.events, 'event', 'events')}</span>
        {person.sessionId ? (
          <Link
            href={withQuery(PAGES.sessionDetail(person.app, person.sessionId), linkQuery)}
            className={cn('text-link', ENTITY_LINK_CLASS)}
          >
            Open session
            <span className="sr-only"> of {person.email}</span>
          </Link>
        ) : null}
      </div>
    </li>
  );
}
