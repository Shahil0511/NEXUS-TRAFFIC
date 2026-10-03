/**
 * Background jobs — listed EXPLICITLY (ctrl-click each call). Runs never overlap per job, timers are
 * unref'd (never keep the process alive), and failures are logged, never thrown.
 *
 * `stop()` clears every timer and then WAITS for runs already in flight, so the shutdown sequence
 * (lifecycle/shutdown.ts) never ends the DB pools under a running job.
 */
import type { Container } from '../container';
import { PARTITION_MAINTENANCE_INTERVAL_MS } from './partition-maintenance.job';
import { RETENTION_CHECK_INTERVAL_MS } from './retention.job';

export interface JobHandle {
  /** Clears the timers; resolves once no job run is in flight. */
  stop(): Promise<void>;
}

/** What the scheduler needs from the container (tests pass a small fake). */
export type JobDeps = Pick<Container, 'jobs' | 'logger'>;

export function startJobs(c: JobDeps): JobHandle {
  const timers: NodeJS.Timeout[] = [];
  const inFlight = new Set<Promise<void>>();

  function every(name: string, intervalMs: number, run: () => Promise<void>): void {
    let running = false;
    const tick = async () => {
      if (running) return; // no overlap: a slow run makes the next tick a no-op
      running = true;
      try {
        await run();
      } catch (err) {
        c.logger.error('job failed', { job: name, err });
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => {
      const pending = tick();
      inFlight.add(pending);
      void pending.finally(() => inFlight.delete(pending));
    }, intervalMs);
    timer.unref();
    timers.push(timer);
  }

  every('partition-maintenance', PARTITION_MAINTENANCE_INTERVAL_MS, () =>
    c.jobs.partitionMaintenance.run(),
  );
  every('retention', RETENTION_CHECK_INTERVAL_MS, () => c.jobs.retention.run());

  return {
    stop: async () => {
      timers.forEach((t) => clearInterval(t));
      await Promise.all([...inFlight]);
    },
  };
}
