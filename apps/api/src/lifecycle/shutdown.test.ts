import type { Server } from 'node:http';

import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../test/fixtures/recording-logger';
import type { JobHandle } from '../jobs/scheduler';
import { createShutdown, type ShutdownDeps } from './shutdown';

function setup(options: { failPools?: boolean } = {}) {
  const order: string[] = [];
  const exits: number[] = [];
  const { logger, calls: logs } = recordingLogger();
  const pool = (name: string) => ({
    end: async () => {
      order.push(`pool:${name}`);
      if (options.failPools) throw new Error('end failed');
    },
  });
  const deps: ShutdownDeps = {
    server: { close: (cb: () => void) => (order.push('server.close'), cb()) } as unknown as Server,
    jobs: { stop: async () => void order.push('jobs.stop') } satisfies JobHandle,
    container: {
      logger,
      pools: { write: pool('write'), query: pool('query') },
    } as unknown as ShutdownDeps['container'],
    closers: [async () => void order.push('realtime.close')],
    exit: (code) => void exits.push(code),
  };
  return { shutdown: createShutdown(deps), order, exits, logs };
}

describe('createShutdown', () => {
  it('closes realtime → server → jobs → pools, then exits 0', async () => {
    const { shutdown, order, exits } = setup();
    await shutdown('SIGTERM');
    expect(order).toEqual([
      'realtime.close',
      'server.close',
      'jobs.stop',
      'pool:write',
      'pool:query',
    ]);
    expect(exits).toEqual([0]);
  });

  it('runs once even if the signal repeats', async () => {
    const { shutdown, order, exits } = setup();
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(order.filter((s) => s === 'jobs.stop')).toHaveLength(1);
    expect(exits).toEqual([0]);
  });

  it('logs a failure and exits 1', async () => {
    const { shutdown, exits, logs } = setup({ failPools: true });
    await shutdown('SIGTERM');
    expect(exits).toEqual([1]);
    expect(logs.map((l) => l.msg)).toContain('shutdown failed');
  });
});
