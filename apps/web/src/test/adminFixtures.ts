/**
 * Typed DTO samples of the S5 pages (Integration, Apps admin) — typed with the shared DTOs, so a
 * contract change breaks them at compile time. Kept apart from ./fixtures.ts (analytics pages).
 */
import type {
  ApiKeyDto,
  AppDto,
  AppIntegrationHealthDto,
  IntegrationHealthDto,
  KeyCreatedDto,
} from '@nexus/shared';

export const HEALTH_TO = '2026-10-01T10:00:00.000Z';

export function appHealth(overrides: Partial<AppIntegrationHealthDto> = {}): AppIntegrationHealthDto {
  return {
    app: 'ebo-sales',
    displayName: 'EBO Sales',
    isActive: true,
    status: 'healthy',
    lastServerEventAt: '2026-10-01T09:58:00.000Z',
    lastBrowserEventAt: '2026-10-01T09:30:00.000Z',
    sdks: [
      {
        source: 'server',
        sdk: '@nexus/express@1.0.0',
        events: 4_200,
        lastSeenAt: '2026-10-01T09:58:00.000Z',
        medianClockSkewMs: 120,
        maxAbsClockSkewMs: 900,
      },
      {
        source: 'browser',
        sdk: '@nexus/react@1.0.0',
        events: 310,
        lastSeenAt: '2026-10-01T09:30:00.000Z',
        medianClockSkewMs: -1_500,
        maxAbsClockSkewMs: 86_000,
      },
    ],
    counters: [
      { source: 'server', accepted: 4_200, duplicates: 12, rejected: 3, rateLimited: 0 },
      { source: 'browser', accepted: 310, duplicates: 0, rejected: 0, rateLimited: 0 },
    ],
    exposedKeys: [
      {
        id: '0b7a1f9e-1111-4c6d-8e7f-001122334455',
        keyPrefix: 'nx_sk_AbCd1234',
        label: 'prod backend',
        exposedAt: '2026-10-01T08:00:00.000Z',
      },
    ],
    privateIpRatio: 0.97,
    warnings: ['exposed_key', 'private_ips', 'rejected_events'],
    ...overrides,
  };
}

export const INTEGRATION_HEALTH: IntegrationHealthDto = {
  from: '2026-09-30T10:00:00.000Z',
  to: HEALTH_TO,
  apps: [
    appHealth(),
    appHealth({
      app: 'hr-portal',
      displayName: 'HR Portal',
      status: 'never',
      lastServerEventAt: null,
      lastBrowserEventAt: null,
      sdks: [],
      counters: [
        { source: 'server', accepted: 0, duplicates: 0, rejected: 0, rateLimited: 0 },
        { source: 'browser', accepted: 0, duplicates: 0, rejected: 0, rateLimited: 0 },
      ],
      exposedKeys: [],
      privateIpRatio: null,
      warnings: ['never_received'],
    }),
  ],
};

export function apiKey(overrides: Partial<ApiKeyDto> = {}): ApiKeyDto {
  return {
    id: '5d4c3b2a-0000-4000-8000-000000000001',
    kind: 'secret',
    keyPrefix: 'nx_sk_AbCd1234',
    label: 'prod backend',
    publicKey: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    createdBy: 'boss@libas.in',
    expiresAt: null,
    lastUsedAt: '2026-10-01T09:58:00.000Z',
    lastSdk: '@nexus/express@1.0.0',
    exposedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

export const PUBLISHABLE_KEY = `nx_pk_${'P'.repeat(32)}`;

export const ADMIN_APPS: AppDto[] = [
  {
    slug: 'ebo-sales',
    displayName: 'EBO Sales',
    basePath: '/ebo-sales',
    allowedOrigins: ['https://nexus.libas.in'],
    isActive: true,
    browserIngestEnabled: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    keys: [
      apiKey(),
      apiKey({
        id: '5d4c3b2a-0000-4000-8000-000000000002',
        kind: 'publishable',
        keyPrefix: 'nx_pk_PPPPPPPP',
        label: 'browser',
        publicKey: PUBLISHABLE_KEY,
      }),
    ],
  },
];

/** A fake one-time secret (test only). */
export const NEW_SECRET = `nx_sk_${'S'.repeat(40)}`;

export const KEY_CREATED: KeyCreatedDto = {
  key: apiKey({
    id: '5d4c3b2a-0000-4000-8000-000000000003',
    keyPrefix: 'nx_sk_SSSSSSSS',
    label: 'rotation 2026-10',
    lastUsedAt: null,
    lastSdk: null,
  }),
  plaintextKey: NEW_SECRET,
};
