import { PERSON_ACCESS_COALESCE_MS } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { recordingLogger } from '../../test/fixtures/recording-logger';
import type { TrafficFilter } from '../domain/filters';
import type { PersonAccessInsert } from '../domain/inserts';
import type { Viewer } from '../domain/viewer';
import { FixedClock } from '../lib/clock';
import type { PersonAccessLogRepository } from '../repositories/person-access-log.repository';
import type { WebEventQueryRepository } from '../repositories/web-event-query.repository';
import { PersonAccessCoalescer } from './person-access.coalescer';
import { PersonAccessRecorder, type PersonAccess } from './person-access.recorder';

const NOW = new Date('2026-10-01T10:00:00.000Z');
const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const OTHER_ADMIN: Viewer = { email: 'other@libas.in', isAdmin: true };
const SUBJECT = Buffer.alloc(32, 0xab);
const SUBJECT_EMAIL = 'someone@libas.in';
const FILTER: TrafficFilter = {
  from: new Date('2026-09-30T10:00:00.000Z'),
  to: NOW,
  environments: ['prod'],
};

class FakeLog implements Pick<PersonAccessLogRepository, 'record'> {
  readonly entries: PersonAccessInsert[] = [];
  failWith: Error | null = null;

  async record(entry: PersonAccessInsert): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.entries.push(entry);
  }
}

class FakeEmails implements Pick<WebEventQueryRepository, 'findUserEmail'> {
  readonly calls: Array<[Buffer, TrafficFilter]> = [];
  email: string | null = SUBJECT_EMAIL;

  async findUserEmail(userKey: Buffer, filter: TrafficFilter): Promise<string | null> {
    this.calls.push([userKey, filter]);
    return this.email;
  }
}

function build() {
  const log = new FakeLog();
  const emails = new FakeEmails();
  const clock = new FixedClock(NOW);
  const { logger, calls } = recordingLogger();
  const recorder = new PersonAccessRecorder(
    log as unknown as PersonAccessLogRepository,
    emails as unknown as WebEventQueryRepository,
    clock,
    logger,
  );
  return { recorder, log, emails, clock, logs: calls };
}

const access = (overrides: Partial<PersonAccess> = {}): PersonAccess => ({
  viewer: ADMIN,
  subjectUserKey: SUBJECT,
  surface: 'person_profile',
  filter: FILTER,
  ...overrides,
});

describe('PersonAccessRecorder.record', () => {
  it('appends the viewer, the stored key, the surface and a MASKED email (never the full one)', async () => {
    const { recorder, log, emails } = build();
    await recorder.record(access());
    expect(log.entries).toEqual([
      {
        viewerEmail: ADMIN.email,
        subjectUserKey: SUBJECT,
        subjectEmailMasked: 's***@libas.in',
        surface: 'person_profile',
      },
    ]);
    expect(JSON.stringify(log.entries)).not.toContain(SUBJECT_EMAIL);
    expect(emails.calls).toEqual([[SUBJECT, FILTER]]);
  });

  it('looks the email up in emailLookup when given (an empty read is still recorded)', async () => {
    const { recorder, log, emails } = build();
    const wider: TrafficFilter = { ...FILTER, from: new Date('2026-07-01T10:00:00.000Z') };
    await recorder.record(access({ surface: 'person_day', emailLookup: wider }));
    expect(emails.calls).toEqual([[SUBJECT, wider]]);
    expect(log.entries).toEqual([expect.objectContaining({ surface: 'person_day' })]);
  });

  it('coalesces the same viewer + person + surface inside the window (no lookup either)', async () => {
    const { recorder, log, emails, clock } = build();
    await recorder.record(access());
    clock.set(new Date(NOW.getTime() + PERSON_ACCESS_COALESCE_MS - 1));
    await recorder.record(access());
    await recorder.record(access({ viewer: { ...ADMIN, email: 'BOSS@libas.in' } }));
    expect(log.entries).toHaveLength(1);
    expect(emails.calls).toHaveLength(1);

    clock.set(new Date(NOW.getTime() + PERSON_ACCESS_COALESCE_MS));
    await recorder.record(access());
    expect(log.entries).toHaveLength(2);
  });

  it('records each surface, each viewer and each person separately', async () => {
    const { recorder, log } = build();
    await recorder.record(access());
    await recorder.record(access({ surface: 'person_daily' }));
    await recorder.record(access({ viewer: OTHER_ADMIN }));
    await recorder.record(access({ subjectUserKey: Buffer.alloc(32, 0xcd) }));
    expect(log.entries).toHaveLength(4);
  });

  it('records nothing when the person has no event in the window (nothing was shown)', async () => {
    const { recorder, log, emails } = build();
    emails.email = null;
    await recorder.record(access());
    expect(log.entries).toEqual([]);
    // Not claimed: once the person is active, the next request records.
    emails.email = SUBJECT_EMAIL;
    await recorder.record(access());
    expect(log.entries).toHaveLength(1);
  });

  it('NEVER throws: a failed write logs a warning without any email and retries next time', async () => {
    const { recorder, log, logs } = build();
    log.failWith = Object.assign(new Error(`insert failed for ${SUBJECT_EMAIL}`), {
      code: '23514',
    });
    await expect(recorder.record(access())).resolves.toBeUndefined();
    expect(logs).toEqual([
      {
        level: 'warn',
        msg: 'person access log write failed',
        meta: { surface: 'person_profile', code: '23514' },
      },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/@libas\.in/);

    log.failWith = null;
    await recorder.record(access());
    expect(log.entries).toHaveLength(1);
  });

  it('a concurrent request waits, and records itself when the running attempt found no email', async () => {
    const { recorder, log, emails } = build();
    const narrow: TrafficFilter = { ...FILTER, appId: 'app-without-events' };
    let releaseLookup: () => void = () => undefined;
    const lookupDone = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });
    emails.findUserEmail = async (userKey, filter) => {
      emails.calls.push([userKey, filter]);
      if (filter === narrow) {
        await lookupDone;
        return null;
      }
      return SUBJECT_EMAIL;
    };
    const first = recorder.record(access({ surface: 'person_timeline', filter: narrow }));
    const second = recorder.record(access({ surface: 'person_timeline' }));
    releaseLookup();
    await Promise.all([first, second]);
    expect(log.entries.map((entry) => entry.surface)).toEqual(['person_timeline']);
    expect(emails.calls.map(([, filter]) => filter)).toEqual([narrow, FILTER]);
  });

  it('a concurrent request records itself when the running attempt failed to write', async () => {
    const { recorder, log } = build();
    let failNext = true;
    let releaseWrite: () => void = () => undefined;
    const writeDone = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const realRecord = log.record.bind(log);
    log.record = async (entry) => {
      if (failNext) {
        failNext = false;
        await writeDone;
        throw Object.assign(new Error('connection reset'), { code: '08006' });
      }
      await realRecord(entry);
    };
    const first = recorder.record(access());
    const second = recorder.record(access());
    const third = recorder.record(access());
    releaseWrite();
    await Promise.all([first, second, third]);
    // The failed attempt is retried ONCE by a waiter; the other waiter sees that row (coalesced).
    expect(log.entries).toHaveLength(1);
  });

  it('a concurrent repeat is skipped once the running attempt wrote its row', async () => {
    const { recorder, log, emails } = build();
    const [first, second] = [recorder.record(access()), recorder.record(access())];
    await Promise.all([first, second]);
    expect(log.entries).toHaveLength(1);
    expect(emails.calls).toHaveLength(1);
  });

  it('a failed email lookup is handled the same way', async () => {
    const { recorder, emails, logs } = build();
    emails.findUserEmail = async () => {
      throw new TypeError('boom');
    };
    await expect(recorder.record(access())).resolves.toBeUndefined();
    expect(logs[0]?.meta).toEqual({ surface: 'person_profile', code: 'TypeError' });
  });
});

describe('PersonAccessCoalescer', () => {
  it('claims a key once per window, frees it on release, and prunes expired keys', () => {
    const coalescer = new PersonAccessCoalescer(1000);
    expect(coalescer.claim('a', 0)).toBe(true);
    expect(coalescer.claim('a', 999)).toBe(false);
    expect(coalescer.claim('a', 1000)).toBe(true);
    coalescer.release('a');
    expect(coalescer.claim('a', 1001)).toBe(true);

    expect(coalescer.claim('b', 1500)).toBe(true);
    expect(coalescer.size).toBe(2);
    expect(coalescer.claim('c', 2600)).toBe(true);
    // 'a' (until 2001) and 'b' (until 2500) expired by 2600.
    expect(coalescer.size).toBe(1);
  });
});
