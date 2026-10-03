import { browserEventSchema } from '@nexus/shared';
import { describe, expect, it } from 'vitest';

import { browserEvent } from '../../test/ingest-fixtures';
import type { ActorColumns } from './inserts';
import { toWebEventInsert, type BrowserEventEnrichment } from './to-web-event-insert';

const ACTOR: ActorColumns = {
  userEmail: null,
  userKey: null,
  claimedEmail: null,
  identitySource: 'anonymous',
  ip: null,
  ipHash: null,
  ipClass: 'unknown',
  geoCountry: null,
  geoRegion: null,
  geoCity: null,
  geoLat: null,
  geoLon: null,
  uaBrowser: null,
  uaOs: null,
  uaDevice: null,
  sdk: null,
};

const ENRICHMENT: BrowserEventEnrichment = {
  appId: 'app-1',
  sessionId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
  anonymousId: null,
  path: '/ebo-sales/stores',
  pathTemplate: '/ebo-sales/stores',
  referrerPath: null,
  clockSkewMs: null,
  actor: ACTOR,
};

const map = (overrides: Record<string, unknown>) =>
  toWebEventInsert(browserEventSchema.parse(browserEvent(overrides)), ENRICHMENT);

const PAGE_VIEW_ID = 'CCCCCCCC-BBBB-4CCC-8DDD-EEEEEEEEEEEE';

describe('toWebEventInsert', () => {
  it('page_view: nav + referrer host; lower-cases ids; other type columns null', () => {
    const row = map({
      eventId: 'DDDDDDDD-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
      referrerHost: 'google.com',
      seq: 3,
    });
    expect(row).toMatchObject({
      eventId: 'dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      eventType: 'page_view',
      seq: 3,
      nav: 'load',
      referrerHost: 'google.com',
      pageViewId: null,
      visibleMs: null,
      tool: null,
      name: null,
      props: null,
    });
    expect(row.occurredAt).toEqual(new Date('2026-10-01T09:59:58.000Z'));
  });

  it('page_time: final → is_final, reason → time_reason', () => {
    const row = map({
      type: 'page_time',
      pageViewId: PAGE_VIEW_ID,
      visibleMs: 1500,
      final: true,
      reason: 'hidden',
    });
    expect(row).toMatchObject({
      eventType: 'page_time',
      pageViewId: PAGE_VIEW_ID.toLowerCase(),
      visibleMs: 1500,
      isFinal: true,
      timeReason: 'hidden',
      nav: null,
    });
  });

  it('tool_use: tool, action, label, value, props', () => {
    const row = map({
      type: 'tool_use',
      tool: 'audits.export-csv',
      action: 'export',
      label: 'Export',
      value: 2,
      props: { rows: 10 },
    });
    expect(row).toMatchObject({
      eventType: 'tool_use',
      tool: 'audits.export-csv',
      action: 'export',
      label: 'Export',
      value: 2,
      props: { rows: 10 },
    });
  });

  it('custom: name; absent optionals are null', () => {
    const row = map({ type: 'custom', name: 'report.opened' });
    expect(row).toMatchObject({
      eventType: 'custom',
      name: 'report.opened',
      label: null,
      value: null,
      props: null,
      tool: null,
    });
  });
});
