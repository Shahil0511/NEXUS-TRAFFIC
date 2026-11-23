import { describe, expect, it } from 'vitest';

import { encodeKeysetCursor } from '../db/sql';
import type { AccessLogListOptions } from '../domain/filters';
import type { PersonAccessLogRow } from '../domain/rows';
import { BadRequestError } from '../errors/app-error';
import type { PersonAccessLogRepository } from '../repositories/person-access-log.repository';
import { PrivacyService } from './privacy.service';

const USER_KEY = Buffer.alloc(32, 0xab);
const USER_KEY_HEX = USER_KEY.toString('hex');

function row(id: number, key: string): PersonAccessLogRow {
  return {
    id,
    viewed_at: new Date(key),
    viewed_at_key: key,
    viewer_email: 'boss@libas.in',
    subject_user_key: USER_KEY,
    subject_email_masked: 's***@libas.in',
    surface: 'person_profile',
  };
}

class FakeAccessLog implements Pick<PersonAccessLogRepository, 'list'> {
  readonly calls: AccessLogListOptions[] = [];
  rows: PersonAccessLogRow[] = [];

  async list(options: AccessLogListOptions): Promise<PersonAccessLogRow[]> {
    this.calls.push(options);
    return this.rows;
  }
}

function build() {
  const log = new FakeAccessLog();
  return { log, service: new PrivacyService(log as unknown as PersonAccessLogRepository) };
}

describe('PrivacyService.accessLog', () => {
  it('fetches limit + 1, maps the rows (hex key, masked email) and keysets from the last shown', async () => {
    const { log, service } = build();
    log.rows = [
      row(3, '2026-10-01T09:03:00.000003Z'),
      row(2, '2026-10-01T09:02:00.000002Z'),
      row(1, '2026-10-01T09:01:00.000001Z'),
    ];
    const page = await service.accessLog({ limit: 2 });
    expect(log.calls[0]).toEqual({ subjectUserKey: undefined, after: null, limit: 3 });
    expect(page.items).toEqual([
      {
        id: 3,
        viewedAt: '2026-10-01T09:03:00.000Z',
        viewerEmail: 'boss@libas.in',
        subjectUserKey: USER_KEY_HEX,
        subjectEmailMasked: 's***@libas.in',
        surface: 'person_profile',
      },
      expect.objectContaining({ id: 2 }),
    ]);
    expect(page.nextCursor).toBe(encodeKeysetCursor('2026-10-01T09:02:00.000002Z', '2'));

    await service.accessLog({ limit: 2, cursor: page.nextCursor ?? undefined });
    expect(log.calls[1]?.after).toEqual({ viewedAt: '2026-10-01T09:02:00.000002Z', id: 2 });
  });

  it('filters by the stored key of one person', async () => {
    const { log, service } = build();
    await service.accessLog({ limit: 50, userKey: USER_KEY_HEX });
    expect(log.calls[0]?.subjectUserKey?.equals(USER_KEY)).toBe(true);
  });

  it('the last page has no cursor; a tampered cursor is a 400', async () => {
    const { log, service } = build();
    log.rows = [row(1, '2026-10-01T09:01:00.000001Z')];
    expect((await service.accessLog({ limit: 2 })).nextCursor).toBeNull();
    for (const cursor of [
      'garbage',
      encodeKeysetCursor('2026-10-01T09:01:00Z', 'not-a-number'),
      encodeKeysetCursor('2026-10-01T09:01:00Z', '0'),
    ]) {
      await expect(service.accessLog({ limit: 2, cursor })).rejects.toBeInstanceOf(BadRequestError);
    }
  });
});
