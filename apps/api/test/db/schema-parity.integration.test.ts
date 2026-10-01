/**
 * PARITY: every enum CHECK in the database lists EXACTLY the values of its shared `*_VALUES` array,
 * and the key patterns/limits of the contract appear verbatim in their CHECKs. Adding an enum value
 * in packages/shared without a migration (or the reverse) fails here.
 * @see ../../../../packages/shared/src/constants/traffic.ts
 */
import {
  APP_SLUG_PATTERN,
  AUDIT_ACTION_VALUES,
  BROWSER_EVENT_TYPE_VALUES,
  ERROR_CODE_PATTERN,
  HTTP_METHOD_VALUES,
  IDENTIFIED_SOURCE_VALUES,
  IDENTITY_SOURCE_VALUES,
  INGEST_LIMITS,
  INGEST_SOURCE_VALUES,
  IP_CLASS_VALUES,
  KEY_KIND_VALUES,
  NAV_TYPE_VALUES,
  PAGE_TIME_REASON_VALUES,
  SERVER_EVENT_KIND_VALUES,
  TOOL_ACTION_VALUES,
  TOOL_NAME_PATTERN,
} from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RUN_DB_TESTS, createTestDatabase, type TestDatabase } from './test-database';

interface EnumCheck {
  table: string;
  constraint: string;
  values: readonly string[];
}

const ENUM_CHECKS: EnumCheck[] = [
  { table: 'api_requests', constraint: 'api_requests_identity_source_check', values: IDENTITY_SOURCE_VALUES },
  { table: 'web_events', constraint: 'web_events_identity_source_check', values: IDENTITY_SOURCE_VALUES },
  { table: 'api_requests', constraint: 'api_requests_identified_email_check', values: IDENTIFIED_SOURCE_VALUES },
  { table: 'web_events', constraint: 'web_events_identified_email_check', values: IDENTIFIED_SOURCE_VALUES },
  { table: 'api_requests', constraint: 'api_requests_kind_check', values: SERVER_EVENT_KIND_VALUES },
  { table: 'api_requests', constraint: 'api_requests_method_check', values: HTTP_METHOD_VALUES },
  { table: 'web_events', constraint: 'web_events_event_type_check', values: BROWSER_EVENT_TYPE_VALUES },
  { table: 'web_events', constraint: 'web_events_nav_check', values: NAV_TYPE_VALUES },
  { table: 'web_events', constraint: 'web_events_time_reason_check', values: PAGE_TIME_REASON_VALUES },
  { table: 'web_events', constraint: 'web_events_action_check', values: TOOL_ACTION_VALUES },
  { table: 'api_requests', constraint: 'api_requests_ip_class_check', values: IP_CLASS_VALUES },
  { table: 'web_events', constraint: 'web_events_ip_class_check', values: IP_CLASS_VALUES },
  { table: 'api_keys', constraint: 'api_keys_kind_check', values: KEY_KIND_VALUES },
  { table: 'admin_audit_log', constraint: 'admin_audit_log_action_check', values: AUDIT_ACTION_VALUES },
  { table: 'ingest_counters', constraint: 'ingest_counters_source_check', values: INGEST_SOURCE_VALUES },
];

/** Literal fragments that must appear in a constraint's definition. */
const TEXT_CHECKS: { table: string; constraint: string; contains: string }[] = [
  { table: 'apps', constraint: 'apps_slug_check', contains: `'${APP_SLUG_PATTERN.source}'` },
  { table: 'web_events', constraint: 'web_events_tool_check', contains: `'${TOOL_NAME_PATTERN.source}'` },
  { table: 'web_events', constraint: 'web_events_name_check', contains: `'${TOOL_NAME_PATTERN.source}'` },
  { table: 'api_requests', constraint: 'api_requests_error_code_check', contains: `'${ERROR_CODE_PATTERN.source}'` },
  { table: 'api_requests', constraint: 'api_requests_path_check', contains: `<= ${INGEST_LIMITS.maxStoredPathLength}` },
  { table: 'web_events', constraint: 'web_events_path_check', contains: `<= ${INGEST_LIMITS.maxStoredPathLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_route_template_check',
    contains: `<= ${INGEST_LIMITS.maxRouteTemplateLength}`,
  },
  {
    table: 'web_events',
    constraint: 'web_events_path_template_check',
    contains: `<= ${INGEST_LIMITS.maxRouteTemplateLength}`,
  },
  { table: 'api_requests', constraint: 'api_requests_duration_ms_check', contains: `${INGEST_LIMITS.maxDurationMs}` },
  { table: 'web_events', constraint: 'web_events_visible_ms_check', contains: `${INGEST_LIMITS.maxVisibleMs}` },
  { table: 'api_requests', constraint: 'api_requests_release_check', contains: `<= ${INGEST_LIMITS.maxReleaseLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_request_id_check',
    contains: `<= ${INGEST_LIMITS.maxRequestIdLength}`,
  },
  { table: 'web_events', constraint: 'web_events_label_check', contains: `<= ${INGEST_LIMITS.maxLabelLength}` },
  {
    table: 'web_events',
    constraint: 'web_events_referrer_host_check',
    contains: `<= ${INGEST_LIMITS.maxReferrerHostLength}`,
  },
  { table: 'api_requests', constraint: 'api_requests_user_email_check', contains: `<= ${INGEST_LIMITS.maxEmailLength}` },
  {
    table: 'api_requests',
    constraint: 'api_requests_claimed_email_check',
    contains: `<= ${INGEST_LIMITS.maxEmailLength}`,
  },
];

/** `CHECK ((kind = ANY (ARRAY['http'::text, 'stream'::text])))` → ['http', 'stream']. */
function quotedLiterals(definition: string): string[] {
  return [...definition.matchAll(/'([^']*)'::text/g)].map((m) => m[1] ?? '');
}

describe.skipIf(!RUN_DB_TESTS)('schema parity with @nexus/shared (db)', () => {
  let db: TestDatabase;

  async function definitionOf(table: string, constraint: string): Promise<string> {
    const { rows } = await db.ownerPool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS def
         FROM pg_catalog.pg_constraint c
        WHERE c.conrelid = format('traffic.%I', $1::text)::regclass
          AND c.conname = $2`,
      [table, constraint],
    );
    const def = rows[0]?.def;
    if (!def) throw new Error(`constraint ${table}.${constraint} not found`);
    return def;
  }

  beforeAll(async () => {
    db = await createTestDatabase('parity');
  });

  afterAll(async () => {
    await db?.drop();
  });

  it.each(ENUM_CHECKS)('$constraint lists exactly the shared values', async ({ table, constraint, values }) => {
    const literals = quotedLiterals(await definitionOf(table, constraint));
    expect([...literals].sort()).toEqual([...values].sort());
  });

  it.each(TEXT_CHECKS)('$constraint contains $contains', async ({ table, constraint, contains }) => {
    expect(await definitionOf(table, constraint)).toContain(contains);
  });

  it('both event tables carry every ActorColumns column (domain/inserts.ts)', async () => {
    const { rows } = await db.ownerPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'traffic' AND table_name IN ('api_requests', 'web_events')`,
    );
    const columnsOf = (t: string) => new Set(rows.filter((r) => r.table_name === t).map((r) => r.column_name));
    const actorColumns = [
      'user_email', 'user_key', 'claimed_email', 'identity_source', 'ip', 'ip_hash', 'ip_class',
      'geo_country', 'geo_region', 'geo_city', 'geo_lat', 'geo_lon', 'ua_browser', 'ua_os', 'ua_device', 'sdk',
    ];
    for (const table of ['api_requests', 'web_events']) {
      for (const column of actorColumns) expect(columnsOf(table).has(column), `${table}.${column}`).toBe(true);
    }
  });
});
