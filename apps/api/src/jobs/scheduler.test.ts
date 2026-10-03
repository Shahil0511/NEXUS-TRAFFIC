import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordingLogger } from '../../test/fixtures/recording-logger';
import { PARTITION_MAINTENANCE_INTERVAL_MS } from './partition-maintenance.job';
import { RETENTION_CHECK_INTERVAL_MS } from './retention.job';
import { startJobs, type JobDeps } from './scheduler';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(retentionRun: () => Promise<void> = async () => undefined) {
  const { logger, calls: logs } = recordingLogger();
  const partitionRun = vi.fn(async () => undefined);
  const retention = vi.fn(retentionRun);
  const deps = {
    logger,
    jobs: { partitionMaintenance: { run: partitionRun }, retention: { run: retention } },
  } as unknown as JobDeps;
  return { deps, logs, partitionRun, retention };
}

describe('startJobs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs each listed job on its own interval', async () => {
    const { deps, partitionRun, retention } = setup();
    const handle = startJobs(deps);
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS);
    expect(retention).toHaveBeenCalledTimes(1);
    expect(partitionRun).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(
      PARTITION_MAINTENANCE_INTERVAL_MS - RETENTION_CHECK_INTERVAL_MS,
    );
    expect(partitionRun).toHaveBeenCalledTimes(1);
    await handle.stop();
  });

  it('never overlaps runs of the same job (a slow run turns the next tick into a no-op)', async () => {
    const slow = deferred();
    const { deps, retention } = setup(() => slow.promise);
    const handle = startJobs(deps);
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS * 3);
    expect(retention).toHaveBeenCalledTimes(1);
    slow.resolve();
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS);
    expect(retention).toHaveBeenCalledTimes(2);
    await handle.stop();
  });

  it('logs a failed run and keeps the schedule', async () => {
    const { deps, logs, retention } = setup(async () => {
      throw new Error('boom');
    });
    const handle = startJobs(deps);
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS * 2);
    expect(retention).toHaveBeenCalledTimes(2);
    expect(logs.filter((l) => l.msg === 'job failed').map((l) => l.meta?.job)).toEqual([
      'retention',
      'retention',
    ]);
    await handle.stop();
  });

  it('unrefs its timers (they never keep the process alive)', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const handle = startJobs(setup().deps);
    const timers = spy.mock.results.map((r) => r.value as NodeJS.Timeout);
    expect(timers).toHaveLength(2);
    for (const timer of timers) expect(timer.hasRef()).toBe(false);
    spy.mockRestore();
    await handle.stop();
  });

  it('stop() clears the timers and waits for the run in flight', async () => {
    const slow = deferred();
    const { deps, retention } = setup(() => slow.promise);
    const handle = startJobs(deps);
    await vi.advanceTimersByTimeAsync(RETENTION_CHECK_INTERVAL_MS);
    let stopped = false;
    const stopping = handle.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    slow.resolve();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(PARTITION_MAINTENANCE_INTERVAL_MS);
    expect(retention).toHaveBeenCalledTimes(1);
  });
});
