import { describe, expect, it } from 'vitest';

import type { Executor } from '../db/executor';
import type { WebEventInsert } from '../domain/inserts';
import {
  INSERT_WEB_EVENTS_SQL,
  toWebEventColumnArrays,
  WebEventIngestRepository,
} from './web-event-ingest.repository';

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

const row = {
  eventId: 'e1',
  occurredAt: new Date(0),
  eventType: 'tool_use',
  props: { tab: 'stores', count: 2 },
} as unknown as WebEventInsert;

describe('WebEventIngestRepository', () => {
  it('returns [] for an empty batch WITHOUT querying', async () => {
    const { exec, calls } = fakeExec();
    expect(await new WebEventIngestRepository({} as never).insertBatch([], exec)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('sends ONE statement with one array per column and returns the inserted ids', async () => {
    const { exec, calls } = fakeExec(['e1']);
    const repo = new WebEventIngestRepository({} as never);
    expect(await repo.insertBatch([row, { ...row, eventId: 'e2' }], exec)).toEqual(['e1']);
    expect(calls).toHaveLength(1);
    const params = calls[0]!.params as unknown[][];
    expect(params[1]).toEqual(['e1', 'e2']);
    expect(params.every((column) => column.length === 2)).toBe(true);
  });

  it('never supplies received_at and is idempotent on (occurred_at, event_id)', () => {
    expect(INSERT_WEB_EVENTS_SQL).not.toContain('received_at');
    expect(INSERT_WEB_EVENTS_SQL).toContain('ON CONFLICT (occurred_at, event_id) DO NOTHING');
    expect(INSERT_WEB_EVENTS_SQL).toContain('RETURNING event_id');
  });

  it('has exactly as many placeholders as columns', () => {
    const columnList = /INSERT INTO traffic\.web_events \(([^)]*)\)/.exec(INSERT_WEB_EVENTS_SQL)?.[1] ?? '';
    const placeholders = INSERT_WEB_EVENTS_SQL.match(/\$\d+::/g) ?? [];
    expect(columnList.split(',').length).toBe(placeholders.length);
    expect(toWebEventColumnArrays([row])).toHaveLength(placeholders.length);
  });

  it('serializes props as ONE JSON document per row (null stays null)', () => {
    const columnList = (/INSERT INTO traffic\.web_events \(([^)]*)\)/.exec(INSERT_WEB_EVENTS_SQL)?.[1] ?? '')
      .split(',')
      .map((c) => c.trim());
    const propsColumn = toWebEventColumnArrays([row, { ...row, props: null }])[columnList.indexOf('props')];
    expect(propsColumn).toEqual(['{"tab":"stores","count":2}', null]);
  });
});
