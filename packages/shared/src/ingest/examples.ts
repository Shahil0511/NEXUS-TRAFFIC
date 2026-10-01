/**
 * Canonical example payloads.
 *
 * WHY: typed with `satisfies`, so a schema change that breaks them breaks the build. They are
 * emitted to docs/dist/examples/*.json for other teams, used by the OpenAPI document, by the
 * DB parity test ("every example inserts"), and by scripts/demo-traffic.ts.
 */
import type { BrowserIngestBatchInput, ServerIngestBatchInput } from './schemas';

export const SERVER_BATCH_EXAMPLE = {
  sentAt: '2026-10-01T09:30:05.120+05:30',
  sdk: { name: '@nexus/express', version: '1.0.0' },
  events: [
    {
      eventId: '0b8f6c1e-5a2d-4c4f-9a51-2f0f3d7f6a11',
      kind: 'http',
      occurredAt: '2026-10-01T09:30:04.870+05:30',
      method: 'GET',
      path: '/ebo-sales/api/v1/stores/1042',
      routeTemplate: '/ebo-sales/api/v1/stores/:id',
      status: 200,
      durationMs: 41.7,
      ip: '203.0.113.24',
      userEmail: 'someone@libas.in',
      requestId: '9f2c0c1e-77aa-4a51-b1d2-1c9e5a0e1b44',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0',
      responseBytes: 5821,
    },
    {
      eventId: '6a1d3f58-0c1b-4e7e-8d0e-3b9a5c2f7e90',
      kind: 'http',
      occurredAt: '2026-10-01T09:30:04.990+05:30',
      method: 'POST',
      path: '/ebo-sales/api/v1/reports/export',
      routeTemplate: '/ebo-sales/api/v1/reports/export',
      status: 500,
      durationMs: 1290.4,
      ip: '203.0.113.24',
      userEmail: 'someone@libas.in',
      errorCode: 'REPORT_TIMEOUT',
    },
  ],
} satisfies ServerIngestBatchInput;

export const BROWSER_BATCH_EXAMPLE = {
  key: 'nx_pk_00000000000000000000000000000000',
  sentAt: '2026-10-01T04:01:10.002Z',
  sessionId: '5b0d6f7e-2a3c-4d1e-9f8a-7b6c5d4e3f21',
  anonymousId: '2c9a8b7d-6e5f-4a3b-9c1d-0e2f3a4b5c6d',
  client: { sdk: '@nexus/react', version: '1.0.0', tz: 'Asia/Kolkata', lang: 'en-IN' },
  events: [
    {
      eventId: 'a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      type: 'page_view',
      occurredAt: '2026-10-01T04:00:12.000Z',
      seq: 0,
      path: '/ebo-audit/audits',
      nav: 'load',
    },
    {
      eventId: 'b4e2d3c5-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
      type: 'tool_use',
      occurredAt: '2026-10-01T04:00:40.500Z',
      seq: 1,
      path: '/ebo-audit/audits',
      tool: 'audits.export-csv',
      action: 'export',
      label: 'Export CSV',
    },
    {
      eventId: 'c5f3e4d6-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
      type: 'page_time',
      occurredAt: '2026-10-01T04:01:10.000Z',
      seq: 2,
      path: '/ebo-audit/audits',
      pageViewId: 'a3f1c2d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      visibleMs: 57400,
      final: true,
      reason: 'route',
    },
  ],
} satisfies BrowserIngestBatchInput;
