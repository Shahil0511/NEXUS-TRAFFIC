/**
 * The per-row credit cap of tab visible time (S5, `seedVisibleCreditCap`, its own database) against a
 * real, migrated database on the READ-ONLY query pool: every read that sums `page_time.visible_ms`
 * for a shown time credits one row at most VISIBLE_DELTA_CREDIT_CAP_MS, and a NULL (an API row,
 * another event type) adds nothing.
 *
 * WHY: the unit suite proves the CASE is spelled at all four sum sites; only PostgreSQL can prove
 * that it is NULL-safe inside SUM … FILTER and over the UNION ALL of both tables, and that person,
 * visit, page and timeline numbers agree on the same visit.
 * @see ../../src/db/sql.ts (creditedVisibleMs)
 * @see ../../../../ai-context/decisions/0017-person-daily-depth.md
 */
import { VISIBLE_DELTA_CREDIT_CAP_MS } from '@nexus/shared';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createQueryPool } from '../../src/db/pool';
import type { TrafficFilter } from '../../src/domain/filters';
import { WebEventQueryRepository } from '../../src/repositories/web-event-query.repository';
import { sha256 } from './fixtures';
import {
  SLEEP_DELTA_MS,
  seedVisibleCreditCap,
  USER_E,
  type VisibleCreditCapSeed,
} from './analytics-seed';
import { createTestDatabase, quietLogger, RUN_DB_TESTS, type TestDatabase } from './test-database';

const HOUR = 3_600_000;
/** The 3 h delta credited as the cap, plus the 4 s tick of the same page view. */
const CREDITED_MS = VISIBLE_DELTA_CREDIT_CAP_MS + 4000;

describe.skipIf(!RUN_DB_TESTS)('credited tab visible time on the query pool (db)', () => {
  let db: TestDatabase;
  let queryPool: Pool;
  let seed: VisibleCreditCapSeed;
  let webEvents: WebEventQueryRepository;
  let filter: TrafficFilter;
  const userKey = sha256(USER_E);

  beforeAll(async () => {
    db = await createTestDatabase('visible-credit-cap');
    seed = await seedVisibleCreditCap(db);
    queryPool = createQueryPool(db.appUrl, 4, quietLogger);
    webEvents = new WebEventQueryRepository(queryPool);
    filter = {
      from: new Date(seed.now.getTime() - 24 * HOUR),
      to: seed.now,
      environments: null,
    };
  });

  afterAll(async () => {
    await queryPool?.end();
    await db?.drop();
  });

  it('the seed really holds a delta above the cap (the test would prove nothing otherwise)', () => {
    expect(SLEEP_DELTA_MS).toBeGreaterThan(VISIBLE_DELTA_CREDIT_CAP_MS);
  });

  it('person day: the long delta counts as the cap and the API row adds nothing (NULL stays NULL)', async () => {
    const rows = await webEvents.listUserDailyActivity(userKey, filter);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ active_ms: CREDITED_MS, requests: 1, page_views: 1 });
  });

  it('visit: the Visits list and the visit header credit the same time', async () => {
    const [listed] = await webEvents.listSessions(filter, { userKey, limit: 5, offset: 0 });
    expect(listed?.visible_ms).toBe(CREDITED_MS);
    const session = await webEvents.getSession(seed.appIds.sales, seed.sessionId, filter);
    expect(session?.summary.visible_ms).toBe(CREDITED_MS);
    const view = session?.browserEvents.find((event) => event.event_id === seed.pageViewId);
    expect(view?.visible_ms).toBe(CREDITED_MS);
  });

  it('page: the page stats average the credited time of the view', async () => {
    const [page] = await webEvents.listPageStats(filter, 5);
    expect(page).toMatchObject({ path_template: '/home', views: 1 });
    expect(page?.avg_visible_ms).toBe(CREDITED_MS);
    expect(page?.p50_visible_ms).toBe(CREDITED_MS);
  });

  it('person timeline: the page view carries the credited time', async () => {
    const items = await webEvents.listUserTimeline(userKey, filter, { after: null, limit: 10 });
    const view = items.find((item) => item.event_id === seed.pageViewId);
    expect(view?.visible_ms).toBe(CREDITED_MS);
  });
});
