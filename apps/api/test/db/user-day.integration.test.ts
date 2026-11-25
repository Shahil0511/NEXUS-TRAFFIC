/**
 * ROUTES.users.day (S6, `seedUserDay`, its own database) against a real, migrated database on the
 * READ-ONLY query pool: UserService.day over WebEventQueryRepository.listUserDayBlocks /
 * listUserDayPages / listUserDayTools, listUserDailyActivity and listSessions; and ROUTES.users.pattern
 * (UserService.pattern over listUserActivityPattern) on the same dataset.
 *
 * WHY: the unit suites prove the SQL shape and the mapping with fakes; only PostgreSQL can prove the
 * interval maths — overlapping tabs counted once in time in app, the credit cap, NULL visible_ms of
 * API rows, the 5-minute join gap, the clamp of a tick to the day start, IST day boundaries, and
 * that the day totals survive the block LIMIT. The dataset is described in ./analytics-seed.ts (S6).
 */
import {
  addReportingDays,
  reportingDayOf,
  reportingDayWindow,
  VISIBLE_DELTA_CREDIT_CAP_MS,
} from '@nexus/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createQueryPool } from '../../src/db/pool';
import type { Viewer } from '../../src/domain/viewer';
import { FixedClock } from '../../src/lib/clock';
import { ApiRequestQueryRepository } from '../../src/repositories/api-request-query.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { WebEventQueryRepository } from '../../src/repositories/web-event-query.repository';
import { AppSlugResolver } from '../../src/services/app-slug.resolver';
import type { PersonAccessRecorder } from '../../src/services/person-access.recorder';
import { UserService } from '../../src/services/user.service';
import { FakePersonAccess } from '../fixtures/fake-query-repositories';
import {
  HR_SLUG,
  SALES_SLUG,
  seedUserDay,
  USER_F,
  userKeyHex,
  type UserDaySeed,
} from './analytics-seed';
import { sha256 } from './fixtures';
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };

describe.skipIf(!RUN_DB_TESTS)('users.day as nexus_app on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let seed: UserDaySeed;
  let webEvents: WebEventQueryRepository;
  let users: UserService;
  let today: string;
  /** An instant `ms` after 00:00 IST of today, as ISO. */
  const at = (ms: number) => new Date(seed.dayStart.getTime() + ms).toISOString();

  beforeAll(async () => {
    db = await createTestDatabase('user-day');
    seed = await seedUserDay(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    webEvents = new WebEventQueryRepository(queryPool);
    users = new UserService(
      webEvents,
      new ApiRequestQueryRepository(queryPool),
      new AppSlugResolver(new AppRepository(queryPool)),
      new FixedClock(seed.now),
      new FakePersonAccess() as unknown as PersonAccessRecorder,
    );
    today = reportingDayOf(seed.now);
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  it('joins breaks under 5 min into one block and splits at 6 min, in start order', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.blocks.map((block) => [block.startAt, block.endAt])).toEqual([
      [at(0), at(3 * SECOND)],
      // The tool use 4 min after the last tick joins block 2 …
      [at(9 * HOUR), at(9 * HOUR + 4 * MINUTE + 20 * SECOND)],
      // … the custom event 6 min after it starts block 3.
      [at(9 * HOUR + 10 * MINUTE + 20 * SECOND), at(9 * HOUR + 10 * MINUTE + 20 * SECOND)],
      [at(10 * HOUR + 58 * MINUTE), at(11 * HOUR)],
    ]);
    expect(dto.blocks[2]?.spanMs).toBe(0);
    expect(dto).toMatchObject({ blockCount: 4, blocksTruncated: false });
  });

  it('two tabs open at once: time in app counts the overlap once, tab visible time twice', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    const twoTabs = dto.blocks[1];
    expect(twoTabs).toMatchObject({
      timeInAppMs: 20_000,
      activeMs: 30_000,
      apps: [SALES_SLUG, HR_SLUG].sort(),
      pageViews: 2,
      toolUses: 1,
      requests: 1,
    });
    expect(twoTabs?.timeInAppMs).toBeLessThan(twoTabs?.activeMs ?? 0);
  });

  it('a 3 h delta is credited as 60 s, and its interval starts 60 s before the tick', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.blocks[3]).toMatchObject({
      timeInAppMs: VISIBLE_DELTA_CREDIT_CAP_MS,
      activeMs: VISIBLE_DELTA_CREDIT_CAP_MS,
    });
  });

  it('API rows are not credited 60 s (their visible_ms is NULL): the day is 95 s tab visible', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.summary).toMatchObject({ activeMs: 95_000, requests: 2, failedRequests: 1 });
    expect(dto.timeInAppMs).toBe(3000 + 20_000 + 0 + 60_000);
  });

  it('a page_time tick at 00:00:03 IST is clamped to the day start', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.blocks[0]).toMatchObject({
      startAt: at(0),
      timeInAppMs: 3000,
      activeMs: 5000,
      pageViews: 1,
    });
  });

  it('a call between blocks counts in requestsOutsideBlocks', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.requestsOutsideBlocks).toBe(1);
    expect(dto.blocks.reduce((total, block) => total + block.requests, 0)).toBe(1);
  });

  it('18:29:59Z belongs to the IST day before, 18:30:00Z to the next one', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.summary?.firstActivityAt).toBe(at(0));
    expect(new Date(at(0)).getUTCHours() * 60 + new Date(at(0)).getUTCMinutes()).toBe(18 * 60 + 30);
    const yesterday = await users.day(
      userKeyHex(USER_F),
      { day: addReportingDays(today, -1) },
      ADMIN,
    );
    expect(yesterday.summary).toMatchObject({
      firstActivityAt: at(-10 * SECOND),
      lastActivityAt: at(-1 * SECOND),
      pageViews: 1,
      activeMs: 0,
    });
  });

  it('lists pages and features in first-use order with their totals, and the visits newest first', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today }, ADMIN);
    expect(dto.pages.map((page) => [page.app, page.pathTemplate, page.views])).toEqual([
      [SALES_SLUG, '/boundary', 1],
      [SALES_SLUG, '/late', 0],
      [SALES_SLUG, '/home', 1],
      [HR_SLUG, '/leaves', 1],
      [SALES_SLUG, '/report', 1],
    ]);
    // The view of /late was opened the day before: only its tick is on this day.
    expect(dto.pages[1]).toMatchObject({ firstViewAt: null, activeMs: 5000 });
    expect(dto.pagesTotal).toBe(5);
    expect(dto.tools).toEqual([expect.objectContaining({ tool: 'export-csv', uses: 1 })]);
    expect(dto.toolsTotal).toBe(1);
    expect(dto.summary?.visits).toBe(5);
    expect(dto.visits).toHaveLength(5);
    const lastActivity = dto.visits.map((visit) => visit.lastActivityAt);
    expect([...lastActivity].sort().reverse()).toEqual(lastActivity);
    expect(JSON.stringify(dto.visits)).not.toContain(USER_F);
  });

  it('the day totals are computed before the block LIMIT', async () => {
    const rows = await webEvents.listUserDayBlocks(
      sha256(USER_F),
      {
        from: seed.dayStart,
        to: new Date(seed.dayStart.getTime() + 24 * HOUR),
        environments: ['prod'],
      },
      2,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      block_count: 4,
      day_time_in_app_ms: 83_000,
      requests_in_blocks: 1,
    });
  });

  it('narrows to one app with the app filter (blocks, calls and visits of that app only)', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: today, app: HR_SLUG }, ADMIN);
    expect(dto.summary).toMatchObject({ activeMs: 10_000, requests: 0, visits: 1 });
    expect(dto.blocks).toHaveLength(1);
    expect(dto.blocks[0]).toMatchObject({ apps: [HR_SLUG], timeInAppMs: 10_000 });
    expect(dto.visits.map((visit) => visit.app)).toEqual([HR_SLUG]);
  });

  it('an empty day is a 200 with no summary and empty lists', async () => {
    const dto = await users.day(userKeyHex(USER_F), { day: addReportingDays(today, -10) }, ADMIN);
    expect(dto).toMatchObject({
      summary: null,
      blocks: [],
      pages: [],
      tools: [],
      visits: [],
      timeInAppMs: 0,
      blockCount: 0,
      requestsOutsideBlocks: 0,
    });
  });

  // ─── users.pattern (usual activity hours) on the same day ────────────────

  /** ISO weekday (1 = Monday) of an IST day `YYYY-MM-DD`. */
  const isoWeekday = (day: string) => ((new Date(`${day}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;

  it('pattern: weekday and hour are IST (18:29:59Z is 23:59 of the day before, 18:30Z is 00:00)', async () => {
    const dto = await users.pattern(userKeyHex(USER_F), { range: '30d' }, ADMIN);
    const yesterday = addReportingDays(today, -1);
    const D = isoWeekday(today);
    const Y = isoWeekday(yesterday);
    expect(dto.cells).toEqual([
      ...(Y < D ? [{ weekday: Y, hour: 23, activeDays: 1, activeMs: 0 }] : []),
      // 00:00:00 page view + the 00:00:03 tick of 5000 ms.
      { weekday: D, hour: 0, activeDays: 1, activeMs: 5000 },
      // Two tabs: 10 000 + 10 000 + 10 000 ms; the API call at 09:02 adds nothing.
      { weekday: D, hour: 9, activeDays: 1, activeMs: 30_000 },
      // The 10:00 API call and the 10:58 page view: activity, no tab visible time (NULL stays NULL).
      { weekday: D, hour: 10, activeDays: 1, activeMs: 0 },
      // The 3 h tick at 11:00 is credited 60 s.
      { weekday: D, hour: 11, activeDays: 1, activeMs: VISIBLE_DELTA_CREDIT_CAP_MS },
      ...(Y > D ? [{ weekday: Y, hour: 23, activeDays: 1, activeMs: 0 }] : []),
    ]);
    expect(dto.activeDays).toBe(2);
  });

  it('pattern: the window is the last 30 days widened to 31 whole IST days, every weekday counted', async () => {
    const dto = await users.pattern(userKeyHex(USER_F), { range: '30d' }, ADMIN);
    expect(dto.window.from).toBe(
      reportingDayWindow(addReportingDays(today, -30)).from.toISOString(),
    );
    expect(dto.window.to).toBe(reportingDayWindow(today).to.toISOString());
    expect(dto.weekdayDays).toHaveLength(7);
    expect(dto.weekdayDays.reduce((a, b) => a + b, 0)).toBe(31);
  });

  it('pattern: narrows to one app (hr-portal: one tab at 09:00 only)', async () => {
    const dto = await users.pattern(userKeyHex(USER_F), { range: '7d', app: HR_SLUG }, ADMIN);
    expect(dto.cells).toEqual([
      { weekday: isoWeekday(today), hour: 9, activeDays: 1, activeMs: 10_000 },
    ]);
    expect(dto.activeDays).toBe(1);
    expect(dto.weekdayDays.reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('pattern: an environment without events gives no cells and 0 active days', async () => {
    const dto = await users.pattern(userKeyHex(USER_F), { range: '30d', env: 'staging' }, ADMIN);
    expect(dto).toMatchObject({ activeDays: 0, cells: [] });
  });
});
