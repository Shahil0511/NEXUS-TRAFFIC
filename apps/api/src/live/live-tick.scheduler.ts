/**
 * The three timers of the live namespace: ticks (LIVE_TICK_MS), event batches
 * (LIVE_EVENTS_FLUSH_MS) and the session sweep (LIVE_SESSION_SWEEP_MS).
 *
 * WHY ONE PLACE: like jobs/scheduler.ts, every recurring realtime task is listed here explicitly,
 * timers are unref'd (they never keep the process alive) and a failing run is logged, never
 * thrown — an exception in a timer callback would crash the api.
 */
import { LIVE_EVENTS_FLUSH_MS, LIVE_SESSION_SWEEP_MS, LIVE_TICK_MS } from '@nexus/shared';

import type { Clock } from '../lib/clock';
import type { Logger } from '../lib/logger';
import type { LiveBroadcaster } from './live.broadcaster';
import type { LiveSessionSweeper } from './live-session.sweeper';
import type { LiveNamespace } from './live-socket';

export class LiveTickScheduler {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly namespace: LiveNamespace,
    private readonly broadcaster: LiveBroadcaster,
    private readonly sweeper: LiveSessionSweeper,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timers.length > 0) return;
    this.every('live tick', LIVE_TICK_MS, () =>
      this.broadcaster.emitTicks(this.namespace, this.clock.now()),
    );
    this.every('live events', LIVE_EVENTS_FLUSH_MS, () =>
      this.broadcaster.flushEvents(this.namespace),
    );
    this.every('live session sweep', LIVE_SESSION_SWEEP_MS, () =>
      this.sweeper.sweep(this.namespace, this.clock.now()),
    );
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  private every(name: string, ms: number, run: () => void): void {
    const timer = setInterval(() => {
      try {
        run();
      } catch (err) {
        this.logger.warn(`${name} failed`, { err });
      }
    }, ms);
    timer.unref();
    this.timers.push(timer);
  }
}
