import { REJECTION_MAX_DISTINCT_PER_BATCH } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { beaconOriginOf, toPiiIncrements, toRejectionIncrements, type RejectionKey } from './ingest-diagnostics';

describe('toRejectionIncrements', () => {
  it('counts per (code, schema_path) in first-seen order', () => {
    const rows = toRejectionIncrements('server', '@nexus/express@1.1.0', [
      { code: 'INVALID_EVENT', schemaPath: 'status' },
      { code: 'INVALID_EVENT', schemaPath: 'method' },
      { code: 'INVALID_EVENT', schemaPath: 'status' },
    ]);
    expect(rows).toEqual([
      { source: 'server', sdk: '@nexus/express@1.1.0', code: 'INVALID_EVENT', schemaPath: 'status', rejected: 2 },
      { source: 'server', sdk: '@nexus/express@1.1.0', code: 'INVALID_EVENT', schemaPath: 'method', rejected: 1 },
    ]);
  });

  it('caps distinct keys; later new keys fold into schema_path ""', () => {
    const keys: RejectionKey[] = Array.from({ length: 25 }, (_, i) => ({ code: 'INVALID_EVENT', schemaPath: `f${i}` }));
    keys.push({ code: 'INVALID_EVENT', schemaPath: 'f0' });
    const rows = toRejectionIncrements('browser', '', keys);
    expect(rows).toHaveLength(REJECTION_MAX_DISTINCT_PER_BATCH + 1);
    expect(rows.find((r) => r.schemaPath === 'f0')?.rejected).toBe(2);
    expect(rows.find((r) => r.schemaPath === '')?.rejected).toBe(25 - REJECTION_MAX_DISTINCT_PER_BATCH);
    expect(rows.reduce((sum, r) => sum + r.rejected, 0)).toBe(26);
  });
});

describe('toPiiIncrements', () => {
  it('sums per (field, kind) across events', () => {
    expect(
      toPiiIncrements([
        [
          { field: 'path', kind: 'phone' },
          { field: 'label', kind: 'email' },
        ],
        [{ field: 'path', kind: 'phone' }],
        [],
      ]),
    ).toEqual([
      { field: 'path', kind: 'phone', detections: 2 },
      { field: 'label', kind: 'email', detections: 1 },
    ]);
  });
});

describe('beaconOriginOf', () => {
  const PUBLIC = 'https://nexus.libas.in';
  it.each([
    [null, 'none'],
    ['https://nexus.libas.in', 'same_origin'],
    ['HTTPS://NEXUS.LIBAS.IN/', 'same_origin'],
    ['https://ebo.libas.in', 'cross_origin'],
  ] as const)('%s → %s', (origin, expected) => {
    expect(beaconOriginOf(origin, PUBLIC)).toBe(expected);
  });
});
