import { describe, expect, it } from 'vitest';

import { fakeLockPool } from '../../test/fixtures/fake-lock-pool';
import { fake } from '../../test/ingest-fixtures';
import type { Executor } from '../db/executor';
import { ADVISORY_LOCKS } from '../db/schema';
import type { PartitionService } from '../services/partition.service';
import { PartitionMaintenanceJob } from './partition-maintenance.job';

function setup(locked = true) {
  const lockPool = fakeLockPool({ locked });
  const calls: Array<Executor | undefined> = [];
  const service = fake<PartitionService>({
    ensureAhead: async (exec?: Executor) => {
      calls.push(exec);
    },
  });
  return { lockPool, calls, job: new PartitionMaintenanceJob(lockPool.pool, service) };
}

describe('PartitionMaintenanceJob', () => {
  it('takes the partitions advisory lock and runs ensureAhead on THAT client', async () => {
    const { lockPool, calls, job } = setup();
    await job.run();

    expect(calls).toEqual([lockPool.client]);
    const lock = lockPool.queries.find((q) => q.sql.includes('pg_try_advisory_xact_lock'));
    expect(lock?.params).toEqual([ADVISORY_LOCKS.partitions]);
    expect(lockPool.queries.map((q) => q.sql).at(-1)).toBe('COMMIT');
    expect(lockPool.released).toBe(1);
  });

  it('does nothing when another replica holds the lock', async () => {
    const { lockPool, calls, job } = setup(false);
    await job.run();
    expect(calls).toEqual([]);
    expect(lockPool.released).toBe(1);
  });
});
