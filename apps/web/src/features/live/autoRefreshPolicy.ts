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
 * Groups NOT refreshed by traffic: who-am-I and the app list do not change with traffic, and the
 * Live page keeps its own cache current from the same socket (useLiveFeed).
 */
const NOT_TRAFFIC_DRIVEN: ReadonlySet<string> = new Set([
  qk.me.all[0],
  qk.apps.all[0],
  qk.live.all[0],
]);

/** True for query keys whose data changes when new traffic arrives. */
export function isTrafficDrivenKey(queryKey: QueryKey): boolean {
  const group = queryKey[0];
  return typeof group === 'string' && !NOT_TRAFFIC_DRIVEN.has(group);
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
