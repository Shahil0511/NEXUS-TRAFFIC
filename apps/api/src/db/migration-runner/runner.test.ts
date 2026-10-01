import { describe, expect, it } from 'vitest';

import { createLogger } from '../../lib/logger';
import { connectWithRetry, describeTarget, parseMigrateMode } from './runner';

const logger = createLogger('error');

describe('parseMigrateMode', () => {
  it.each([
    [[], 'apply'],
    [['--status'], 'status'],
    [['--dry'], 'dry'],
  ] as const)('%j → %s', (argv, mode) => {
    expect(parseMigrateMode(argv)).toBe(mode);
  });

  it('refuses unknown flags so a typo never applies migrations', () => {
    expect(() => parseMigrateMode(['--stauts'])).toThrow(/unknown flag/);
  });
});

describe('describeTarget', () => {
  it('prints host, port and database only — never user or password', () => {
    const text = describeTarget('postgres://owner:s3cr3t-pass@postgres:5432/nexus_traffic');
    expect(text).toBe('postgres:5432/nexus_traffic');
    expect(text).not.toContain('s3cr3t');
    expect(text).not.toContain('owner');
  });

  it('never echoes an unparseable string', () => {
    expect(describeTarget('not a url with password hunter2')).not.toContain('hunter2');
  });
});

describe('connectWithRetry', () => {
  it('retries until SELECT 1 succeeds', async () => {
    let calls = 0;
    const pool = {
      query: async () => {
        calls += 1;
        if (calls < 3) throw new Error('ECONNREFUSED');
        return { rows: [] };
      },
    };
    const sleeps: number[] = [];
    await connectWithRetry(pool as never, logger, {
      attempts: 5,
      delayMs: 2000,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('rethrows the last error after the final attempt', async () => {
    let calls = 0;
    const pool = {
      query: async () => {
        calls += 1;
        throw new Error(`down ${calls}`);
      },
    };
    await expect(
      connectWithRetry(pool as never, logger, { attempts: 3, delayMs: 1, sleep: async () => undefined }),
    ).rejects.toThrow('down 3');
  });
});
