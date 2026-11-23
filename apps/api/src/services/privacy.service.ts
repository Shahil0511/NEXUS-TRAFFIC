/**
 * ROUTES.privacy.* — the Privacy & access page (admins only).
 */
import type { CursorPage, PersonAccessEntryDto, PrivacyAccessLogQuery } from '@nexus/shared';

import { encodeKeysetCursor } from '../db/sql';
import { mapPersonAccessEntry } from '../domain/mappers';
import { pageFetchSize, parseAccessLogCursor, toCursorPage } from '../domain/pagination';
import { userKeyFromHex } from '../enrichment/user-key.hasher';
import type { PersonAccessLogRepository } from '../repositories/person-access-log.repository';

/** WHY: reads the person access log for admins (the rows are written by PersonAccessRecorder). */
export class PrivacyService {
  constructor(private readonly accessLogs: PersonAccessLogRepository) {}

  /**
   * Who opened whose person page, newest first, keyset-paged on (viewed_at, id); optionally only
   * the rows about one person. Range-free: the log is small (coalesced, admins only).
   * @see ../repositories/person-access-log.repository.ts PersonAccessLogRepository.list
   */
  async accessLog(query: PrivacyAccessLogQuery): Promise<CursorPage<PersonAccessEntryDto>> {
    const rows = await this.accessLogs.list({
      subjectUserKey: query.userKey === undefined ? undefined : userKeyFromHex(query.userKey),
      after: parseAccessLogCursor(query.cursor),
      limit: pageFetchSize(query.limit),
    });
    return toCursorPage(rows, query.limit, mapPersonAccessEntry, (last) =>
      encodeKeysetCursor(last.viewed_at_key, String(last.id)),
    );
  }
}
