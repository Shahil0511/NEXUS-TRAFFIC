import { describe, expect, it } from 'vitest';

import { apiKeyRow, appRow, CREATED_AT } from '../../test/fixtures/app-rows';
import { mapApiKey, mapApp } from './mappers';

describe('mapApiKey', () => {
  it('maps every column to camelCase with ISO dates', () => {
    const later = new Date('2026-09-20T12:30:00.000Z');
    const dto = mapApiKey(
      apiKeyRow({
        expires_at: later,
        last_used_at: later,
        last_sdk: '@nexus/express@1.0.0',
        exposed_at: later,
      }),
    );
    expect(dto).toEqual({
      id: apiKeyRow().id,
      kind: 'secret',
      keyPrefix: 'nx_sk_AbCdEfGh',
      label: 'production',
      publicKey: null,
      createdAt: CREATED_AT.toISOString(),
      createdBy: 'admin@libas.in',
      expiresAt: later.toISOString(),
      lastUsedAt: later.toISOString(),
      lastSdk: '@nexus/express@1.0.0',
      exposedAt: later.toISOString(),
      revokedAt: null,
    });
  });

  it('NEVER exposes the key hash or the revoker', () => {
    const dto = mapApiKey(apiKeyRow({ revoked_at: CREATED_AT, revoked_by: 'boss@libas.in' }));
    expect(dto).not.toHaveProperty('keyHash');
    expect(dto).not.toHaveProperty('key_hash');
    expect(JSON.stringify(dto)).not.toContain('boss@libas.in');
    expect(dto.revokedAt).toBe(CREATED_AT.toISOString());
  });

  it('returns the public key for publishable keys only', () => {
    const pk = 'nx_pk_' + 'a'.repeat(32);
    expect(mapApiKey(apiKeyRow({ kind: 'publishable', public_key: pk })).publicKey).toBe(pk);
    expect(
      mapApiKey(apiKeyRow({ kind: 'secret', public_key: 'should-not-leak' })).publicKey,
    ).toBeNull();
  });
});

describe('mapApp', () => {
  it('maps the app by slug (no internal id) with its keys', () => {
    const dto = mapApp(appRow(), [apiKeyRow()]);
    expect(dto).toEqual({
      slug: 'ebo-sales',
      displayName: 'EBO Sales',
      basePath: '/ebo-sales',
      allowedOrigins: ['https://nexus.libas.in'],
      isActive: true,
      browserIngestEnabled: true,
      createdAt: CREATED_AT.toISOString(),
      keys: [mapApiKey(apiKeyRow())],
    });
    expect(dto).not.toHaveProperty('id');
  });

  it('copies allowed origins (no aliasing of the row array)', () => {
    const row = appRow();
    const dto = mapApp(row, []);
    dto.allowedOrigins.push('https://evil.example');
    expect(row.allowed_origins).toEqual(['https://nexus.libas.in']);
    expect(dto.keys).toEqual([]);
  });
});
