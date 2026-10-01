import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../test/fixtures/recording-logger';
import { fakeLockPool } from '../../test/fixtures/fake-lock-pool';
import { fake } from '../../test/ingest-fixtures';
import type { Executor } from '../db/executor';
import { ADVISORY_LOCKS } from '../db/schema';
import { FixedClock } from '../lib/clock';
import type { PartitionService } from '../services/partition.service';
import { RetentionJob } from './retention.job';

/** 02:45 IST on 2026-10-02 = 21:15 UTC on 2026-10-01 (inside the 02:30–03:30 window). */
const IN_WINDOW = new Date('2026-10-01T21:15:00.000Z');
/** 12:00 IST — outside the window. */
const OUT_OF_WINDOW = new Date('2026-10-02T06:30:00.000Z');

function setup(options: { locked?: boolean; fail?: number } = {}) {
  const lockPool = fakeLockPool({ locked: options.locked });
  const clock = new FixedClock(IN_WINDOW);
  const { logger, calls: logs } = recordingLogger();
  const calls: Array<Executor | undefined> = [];
  let failuresLeft = options.fail ?? 0;
  const service = fake<PartitionService>({
    dropExpired: async (exec?: Executor) => {
      calls.push(exec);
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
      }
      return ['api_requests_y2026m03'];
    },
  });
  const job = new RetentionJob(lockPool.pool, service, clock, logger);
  return { lockPool, clock, logs, calls, job };
}

describe('RetentionJob', () => {
  it('takes the retention advisory lock and drops on THAT client', async () => {
    const { lockPool, calls, logs, job } = setup();
    await job.run();

    expect(calls).toEqual([lockPool.client]);
    const lock = lockPool.queries.find((q) => q.sql.includes('pg_try_advisory_xact_lock'));
    expect(lock?.params).toEqual([ADVISORY_LOCKS.retention]);
    expect(lockPool.queries.map((q) => q.sql).at(-1)).toBe('COMMIT');
    expect(logs).toContainEqual({ level: 'info', msg: 'retention run', meta: { droppedCount: 1 } });
  });

  it('runs at most once per IST day', async () => {
    const { calls, clock, job } = setup();
    await job.run();
    await job.run();
    expect(calls).toHaveLength(1);
    clock.set(new Date(IN_WINDOW.getTime() + 24 * 60 * 60 * 1000)); // next IST day, same time
    await job.run();
    expect(calls).toHaveLength(2);
  });

  it('does nothing outside the 02:30–03:30 IST window', async () => {
    const { lockPool, calls, clock, job } = setup();
    clock.set(OUT_OF_WINDOW);
    await job.run();
    expect(calls).toEqual([]);
    expect(lockPool.queries).toEqual([]);
  });

  it('counts the day as done when another replica holds the lock', async () => {
    const { calls, lockPool, logs, job } = setup({ locked: false });
    await job.run();
    await job.run();
    expect(calls).toEqual([]);
    expect(lockPool.queries.filter((q) => q.sql.includes('pg_try_advisory_xact_lock'))).toHaveLength(1);
    expect(logs.map((l) => l.msg)).toContain('retention run skipped: another replica holds the lock');
  });

  it('retries on the next tick after a failure (e.g. 55P03 lock timeout)', async () => {
    const { calls, lockPool, job } = setup({ fail: 1 });
    await expect(job.run()).rejects.toMatchObject({ code: '55P03' });
    expect(lockPool.queries.map((q) => q.sql).at(-1)).toBe('ROLLBACK');
    await job.run();
    expect(calls).toHaveLength(2);
  });
});
