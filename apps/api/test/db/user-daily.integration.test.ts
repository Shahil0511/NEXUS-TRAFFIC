/**
 * ROUTES.users.daily per app (S4, `seedUserDailyApps`, its own database) against a real, migrated
 * database on the READ-ONLY query pool: the (IST day, app) rows of
 * WebEventQueryRepository.listUserDailyActivity folded by foldUserDays.
 *
 * WHY: the unit suites prove the SQL shape and the fold with fakes; only PostgreSQL can prove the
 * per-app split — first-activity order inside a day, per-app visits (distinct (app, session) of
 * browser rows), an API-only app with no tab visible time and no visit, and IST day boundaries.
 * The dataset is described in ./analytics-seed.ts (S4).
 */
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
  seedUserDailyApps,
  USER_D,
  userKeyHex,
  type UserDailyAppsSeed,
} from './analytics-seed';
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };

describe.skipIf(!RUN_DB_TESTS)('users.daily per app as nexus_app on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let seed: UserDailyAppsSeed;
  let users: UserService;
  const ago = (ms: number) => new Date(seed.now.getTime() - ms).toISOString();

  beforeAll(async () => {
    db = await createTestDatabase('user-daily');
    seed = await seedUserDailyApps(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    const webEvents = new WebEventQueryRepository(queryPool);
    users = new UserService(
      webEvents,
      new ApiRequestQueryRepository(queryPool),
      new AppSlugResolver(new AppRepository(queryPool)),
      new FixedClock(seed.now),
      new FakePersonAccess() as unknown as PersonAccessRecorder,
    );
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  it('splits each IST day per app, apps in first-activity order, the day = Σ of its apps', async () => {
    const dto = await users.daily(userKeyHex(USER_D), { range: '24h' }, ADMIN);
    // seed.now is 12:00 IST: today began 12 h ago, yesterday 36 h ago.
    expect(dto.items.map((d) => d.day)).toEqual([ago(12 * HOUR), ago(36 * HOUR)]);
    const [today, yesterday] = dto.items;
    expect(today?.perApp).toEqual([
      {
        app: HR_SLUG,
        firstActivityAt: ago(120 * MINUTE),
        lastActivityAt: ago(110 * MINUTE),
        activeMs: 2000,
        pageViews: 2,
        requests: 0,
        failedRequests: 0,
        toolUses: 0,
        visits: 2,
      },
      {
        app: SALES_SLUG,
        firstActivityAt: ago(60 * MINUTE),
        lastActivityAt: ago(30 * MINUTE),
        activeMs: 4000,
        pageViews: 1,
        requests: 1,
        failedRequests: 1,
        toolUses: 1,
        visits: 1,
      },
    ]);
    expect(today).toMatchObject({
      firstActivityAt: ago(120 * MINUTE),
      lastActivityAt: ago(30 * MINUTE),
      activeMs: 6000,
      pageViews: 3,
      requests: 1,
      failedRequests: 1,
      toolUses: 1,
      visits: 3,
      apps: [SALES_SLUG, HR_SLUG],
      inProgress: true,
    });
    // An app that only sent API calls that day: no tab visible time, no visit.
    expect(yesterday).toMatchObject({
      activeMs: 0,
      requests: 1,
      visits: 0,
      apps: [HR_SLUG],
      inProgress: false,
      perApp: [{ app: HR_SLUG, activeMs: 0, requests: 1, visits: 0 }],
    });
  });

  it('narrows to one app with the app filter', async () => {
    const dto = await users.daily(userKeyHex(USER_D), { range: '24h', app: SALES_SLUG }, ADMIN);
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]?.perApp.map((app) => app.app)).toEqual([SALES_SLUG]);
    expect(dto.items[0]).toMatchObject({ activeMs: 4000, visits: 1 });
  });
});
