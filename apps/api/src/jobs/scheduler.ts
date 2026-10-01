/**
 * Background jobs — listed EXPLICITLY (ctrl-click each call). Runs never overlap per job, timers are
 * unref'd (never keep the process alive), and failures are logged, never thrown.
 */
import type { Container } from '../container';
import { PARTITION_MAINTENANCE_INTERVAL_MS } from './partition-maintenance.job';
import { RETENTION_CHECK_INTERVAL_MS } from './retention.job';

export interface JobHandle {
  stop(): void;
}

export function startJobs(c: Container): JobHandle {
  const timers: NodeJS.Timeout[] = [];

  function every(name: string, intervalMs: number, run: () => Promise<void>): void {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await run();
      } catch (err) {
        c.logger.error('job failed', { job: name, err });
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
    timers.push(timer);
  }

  every('partition-maintenance', PARTITION_MAINTENANCE_INTERVAL_MS, () => c.jobs.partitionMaintenance.run());
  every('retention', RETENTION_CHECK_INTERVAL_MS, () => c.jobs.retention.run());

  return {
    stop: () => timers.forEach((t) => clearInterval(t)),
  };
}
