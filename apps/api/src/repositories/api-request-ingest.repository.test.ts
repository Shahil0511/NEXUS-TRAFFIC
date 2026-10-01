import { describe, expect, it } from 'vitest';

import type { Executor } from '../db/executor';
import type { ApiRequestInsert } from '../domain/inserts';
import { ApiRequestIngestRepository, INSERT_API_REQUESTS_SQL, toColumnArrays } from './api-request-ingest.repository';

/** Executor fake that records calls and returns the given event ids. */
function fakeExec(eventIds: string[] = []) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const exec = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: eventIds.map((event_id) => ({ event_id })) };
    },
  } as unknown as Executor;
  return { exec, calls };
}

const row = { eventId: 'e1', occurredAt: new Date(0), statusCode: 200, userKey: Buffer.alloc(32) } as ApiRequestInsert;

describe('ApiRequestIngestRepository', () => {
  it('returns [] for an empty batch WITHOUT querying', async () => {
    const { exec, calls } = fakeExec();
    expect(await new ApiRequestIngestRepository({} as never).insertBatch([], exec)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('sends ONE statement with one array per column and returns the inserted ids', async () => {
    const { exec, calls } = fakeExec(['e1']);
    expect(await new ApiRequestIngestRepository({} as never).insertBatch([row, { ...row, eventId: 'e2' }], exec)).toEqual(['e1']);
    expect(calls).toHaveLength(1);
    const params = calls[0]!.params as unknown[][];
    expect(params[1]).toEqual(['e1', 'e2']);
    expect(params.every((column) => column.length === 2)).toBe(true);
  });

  it('never supplies received_at and is idempotent on (occurred_at, event_id)', () => {
    expect(INSERT_API_REQUESTS_SQL).not.toContain('received_at');
    expect(INSERT_API_REQUESTS_SQL).toContain('ON CONFLICT (occurred_at, event_id) DO NOTHING');
    expect(INSERT_API_REQUESTS_SQL).toContain('RETURNING event_id');
  });

  it('has exactly as many placeholders as columns', () => {
    const columnList = /INSERT INTO traffic\.api_requests \(([^)]*)\)/.exec(INSERT_API_REQUESTS_SQL)?.[1] ?? '';
    const placeholders = INSERT_API_REQUESTS_SQL.match(/\$\d+::/g) ?? [];
    expect(columnList.split(',').length).toBe(placeholders.length);
    expect(toColumnArrays([row])).toHaveLength(placeholders.length);
  });
});
