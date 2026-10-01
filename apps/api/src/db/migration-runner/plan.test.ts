import { describe, expect, it } from 'vitest';

import type { AppliedMigration } from './ledger';
import type { MigrationFile } from './loader';
import { planMigrations } from './plan';

const file = (version: string, checksum = `sum-${version}`): MigrationFile => ({
  version,
  name: `m${version}`,
  fileName: `${version}_m${version}.sql`,
  sql: '',
  checksum,
});

const applied = (version: string, checksum = `sum-${version}`): AppliedMigration => ({
  version,
  name: `m${version}`,
  checksum,
  appliedAt: new Date(0),
  executionMs: 1,
});

describe('planMigrations', () => {
  it('everything is pending on an empty ledger', () => {
    const plan = planMigrations([file('0002'), file('0001')], []);
    expect(plan.pending.map((f) => f.version)).toEqual(['0001', '0002']);
    expect(plan).toMatchObject({ drifted: [], unknownApplied: [], outOfOrder: [] });
  });

  it('nothing to do when files and ledger agree', () => {
    const plan = planMigrations([file('0001'), file('0002')], [applied('0001'), applied('0002')]);
    expect(plan).toEqual({ pending: [], drifted: [], unknownApplied: [], outOfOrder: [] });
  });

  it('detects drift when an applied file changed', () => {
    const plan = planMigrations([file('0001', 'edited'), file('0002')], [applied('0001'), applied('0002')]);
    expect(plan.drifted.map((d) => [d.file.version, d.applied.checksum, d.file.checksum])).toEqual([
      ['0001', 'sum-0001', 'edited'],
    ]);
    expect(plan.pending).toEqual([]);
  });

  it('reports versions the code does not know as unknown-applied (rollback)', () => {
    const plan = planMigrations([file('0001')], [applied('0003'), applied('0001'), applied('0002')]);
    expect(plan.unknownApplied.map((a) => a.version)).toEqual(['0002', '0003']);
    expect(plan.pending).toEqual([]);
  });

  it('flags pending files older than the newest applied one as out of order', () => {
    const plan = planMigrations([file('0001'), file('0002'), file('0003')], [applied('0001'), applied('0003')]);
    expect(plan.pending.map((f) => f.version)).toEqual(['0002']);
    expect(plan.outOfOrder.map((f) => f.version)).toEqual(['0002']);
  });
});
