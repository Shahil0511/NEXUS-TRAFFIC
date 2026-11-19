import { AGGREGATE_RETENTION_DAYS } from '@nexus/shared';
import { describe, expect, it, vi } from 'vitest';

import { fake, silentLogger } from '../../test/ingest-fixtures';
import type { Executor } from '../db/executor';
import { FixedClock } from '../lib/clock';
import type { AggregateRetentionRepository } from '../repositories/aggregate-retention.repository';
import { AggregateRetentionService } from './aggregate-retention.service';

const NOW = new Date('2026-11-18T21:15:00.000Z');

describe('AggregateRetentionService.deleteExpired', () => {
  it('deletes rows older than AGGREGATE_RETENTION_DAYS on the given executor', async () => {
    const deleteExpired = vi.fn(async (_cutoff: Date, _exec?: Executor) => 3);
    const service = new AggregateRetentionService(
      fake<AggregateRetentionRepository>({ deleteExpired }),
      new FixedClock(NOW),
      silentLogger(),
    );
    const exec = fake<Executor>({});
    await expect(service.deleteExpired(exec)).resolves.toBe(3);
    const cutoff = new Date(NOW.getTime() - AGGREGATE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    expect(deleteExpired).toHaveBeenCalledWith(cutoff, exec);
  });
});
