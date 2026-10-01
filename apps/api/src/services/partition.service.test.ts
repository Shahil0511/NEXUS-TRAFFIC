import { describe, expect, it } from 'vitest';

import { fake, silentLogger } from '../../test/ingest-fixtures';
import type { Executor } from '../db/executor';
import type { PartitionedTable } from '../db/schema';
import type { PartitionRepository } from '../repositories/partition.repository';
import { PARTITION_MONTHS_AHEAD, PARTITION_MONTHS_BACK, PartitionService } from './partition.service';

const exec: Executor = { query: async () => ({ rows: [] }) } as unknown as Executor;

describe('PartitionService', () => {
  it('ensureAhead passes the window and the executor to the repository', async () => {
    const calls: unknown[][] = [];
    const repo = fake<PartitionRepository>({
      ensure: async (...args: [number, number, Executor?]) => {
        calls.push(args);
        return [];
      },
    });
    await new PartitionService(repo, 6, silentLogger()).ensureAhead(exec);
    expect(calls).toEqual([[PARTITION_MONTHS_BACK, PARTITION_MONTHS_AHEAD, exec]]);
  });

  it('dropExpired runs per partitioned table with the retention months and the executor', async () => {
    const calls: unknown[][] = [];
    const repo = fake<PartitionRepository>({
      dropExpired: async (table: PartitionedTable, keep: number, e?: Executor) => {
        calls.push([table, keep, e]);
        return [`${table}_y2026m03`];
      },
    });
    const dropped = await new PartitionService(repo, 6, silentLogger()).dropExpired(exec);
    expect(calls).toEqual([
      ['api_requests', 6, exec],
      ['web_events', 6, exec],
    ]);
    expect(dropped).toEqual(['api_requests_y2026m03', 'web_events_y2026m03']);
  });

  it('without an executor the repository uses its own pool (undefined is passed through)', async () => {
    const calls: unknown[][] = [];
    const repo = fake<PartitionRepository>({
      ensure: async (...args: [number, number, Executor?]) => {
        calls.push(args);
        return [];
      },
    });
    await new PartitionService(repo, 6, silentLogger()).ensureAhead();
    expect(calls[0]?.[2]).toBeUndefined();
  });
});
