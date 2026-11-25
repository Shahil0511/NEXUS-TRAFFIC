/**
 * The pure half of dashboard auto-refresh (the hook is ./useAutoRefresh.ts).
 *
 * WHY: analytics pages load with React Query and a 60 s staleTime (lib/query/client.ts), so on
 * their own they never notice new traffic — the user had to switch pages to see it. The live
 * socket already tells us when committed events arrive; these helpers decide WHAT to refetch and
 * HOW OFTEN, so a busy app cannot turn every event into a burst of dashboard queries.
 */
import type { QueryKey } from '@tanstack/react-query';

import { qk } from '@/lib/query/keys';

/**
 * At most one refresh per this many ms. Ingest SDKs flush every 5 s
 * (SDK_DEFAULTS.*.flushIntervalMs), so new data cannot arrive meaningfully faster.
 */
export const AUTO_REFRESH_MIN_INTERVAL_MS = 5_000;

/**
 * Groups NOT refreshed by traffic: who-am-I and the app list do not change with traffic, the
 * Live page keeps its own cache current from the same socket (useLiveFeed), and the access log
 * does not change with traffic.
 */
const NOT_TRAFFIC_DRIVEN: ReadonlySet<string> = new Set([
  qk.me.all[0],
  qk.apps.all[0],
  qk.live.all[0],
  qk.privacy.all[0],
]);

/** The second key part of the person-level reads (one person's page: PERSON_ROUTE_LEAVES). */
const PERSON_USER_LEAVES: ReadonlySet<unknown> = new Set(
  [
    qk.users.profile('', { range: 'today' }),
    qk.users.timeline('', { range: 'today', limit: 1 }),
    qk.users.devices('', { range: 'today' }),
    qk.users.daily('', { range: 'today' }),
    qk.users.day('', { day: '2026-01-01' }),
    qk.users.pattern('', { range: '30d' }),
  ].map((key) => key[1]),
);

/**
 * The second key part of the single-visit read (`journeys.session`, "Visit steps"). WHY: for a
 * verified person's visit it is a person-level read, recorded as `person_visit_steps` (ADR 0017),
 * and whether a visit is verified is known only from its answer, not from its key. So the whole
 * leaf stays out of traffic refresh: an anonymous visit refreshes on a real action only, and a
 * verified one (or a refused 403) is never re-sent because traffic arrived.
 * @see ../../../../../ai-context/decisions/0017-person-daily-depth.md
 */
const VISIT_STEPS_LEAF: unknown = qk.journeys.session('', '', { range: 'today' })[1];

/**
 * True for query keys whose data changes when new traffic arrives — EXCEPT person-level reads
 * (a person's page, the steps of one visit, or any list narrowed to one person by `userKey`):
 * each of those answers is (or may be) recorded in the person access log, so a background
 * refetch would read as the admin opening the person again. They refresh only on a real action
 * (open, tab, focus, retry).
 */
export function isTrafficDrivenKey(queryKey: QueryKey): boolean {
  const group = queryKey[0];
  if (typeof group !== 'string' || NOT_TRAFFIC_DRIVEN.has(group)) return false;
  if (group === qk.users.all[0] && PERSON_USER_LEAVES.has(queryKey[1])) return false;
  if (group === qk.journeys.all[0] && queryKey[1] === VISIT_STEPS_LEAF) return false;
  return !queryKey.some(isNarrowedToOnePerson);
}

/** A key part that is a query narrowed to one person (`?userKey=`). */
function isNarrowedToOnePerson(part: unknown): boolean {
  return (
    typeof part === 'object' &&
    part !== null &&
    (part as { userKey?: unknown }).userKey !== undefined
  );
}

/**
 * Leading + trailing throttle: the first call runs at once; calls inside the window collapse into
 * ONE run at the end of it. `cancel` drops a pending run (unmount).
 */
export function createThrottle(
  run: () => void,
  intervalMs: number,
  now: () => number = Date.now,
): { request: () => void; cancel: () => void } {
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    timer = undefined;
    lastRunAt = now();
    run();
  };

  return {
    request: () => {
      if (timer !== undefined) return;
      const wait = lastRunAt + intervalMs - now();
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
