/**
 * Remote SDK config (ADR 0009) against a real, migrated database, as nexus_app on the write pool:
 * AppRepository.updateSdkConfig (conditional UPDATE … RETURNING) through
 * AppAdminService.updateSdkConfig (transaction + APP_SDK_CONFIG_UPDATE audit row).
 *
 * WHY: only PostgreSQL proves the optimistic-concurrency UPDATE (no lost update), the column
 * defaults of 0009, the module CHECK (`sdk_disabled_modules <@ SDK_CAPTURE_MODULE_VALUES`), the
 * swapped audit-action CHECK accepting the new action, and that a 409 leaves no audit row behind.
 */
import { ERROR_CODES } from '@nexus/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiKeyGenerator } from '../../src/auth/api-key.generator';
import { ApiKeyHasher } from '../../src/auth/api-key.hasher';
import { AppKeyCache } from '../../src/auth/app-key.cache';
import type { Viewer } from '../../src/domain/viewer';
import { FixedClock } from '../../src/lib/clock';
import { AdminAuditRepository } from '../../src/repositories/admin-audit.repository';
import { ApiKeyRepository } from '../../src/repositories/api-key.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { AppAdminService } from '../../src/services/app-admin.service';
import { createTestDatabase, RUN_DB_TESTS, type TestDatabase } from './test-database';

const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const SLUG = 'sdk-config-app';

describe.skipIf(!RUN_DB_TESTS)('remote SDK config as nexus_app (db)', () => {
  let db: TestDatabase;
  let apps: AppRepository;
  let service: AppAdminService;
  let appId: string;

  /** The audit rows of this app's SDK config, oldest first. */
  async function sdkConfigAudits(): Promise<Array<{ details: Record<string, unknown> }>> {
    const { rows } = await db.ownerPool.query<{ details: Record<string, unknown> }>(
      `SELECT details FROM traffic.admin_audit_log
        WHERE action = 'APP_SDK_CONFIG_UPDATE' AND target_id = $1
        ORDER BY id`,
      [appId],
    );
    return rows;
  }

  beforeAll(async () => {
    db = await createTestDatabase('app_sdk_config');
    apps = new AppRepository(db.appPool);
    const clock = new FixedClock(new Date());
    service = new AppAdminService(
      db.appPool,
      apps,
      new ApiKeyRepository(db.appPool),
      new AdminAuditRepository(db.appPool),
      new ApiKeyGenerator(new ApiKeyHasher('test-pepper-test-pepper-test-pepper')),
      new AppKeyCache(clock),
      clock,
    );
    const app = await apps.insert({
      slug: SLUG,
      displayName: 'SDK Config App',
      basePath: null,
      allowedOrigins: [],
      browserIngestEnabled: true,
      createdBy: ADMIN.email,
    });
    appId = app.id;
  });

  afterAll(async () => {
    await db?.drop();
  });

  it('a new app starts at version 1 with nothing disabled (0009 defaults)', async () => {
    const app = await apps.findBySlug(SLUG);
    expect(app).toMatchObject({
      sdk_config_version: 1,
      sdk_disabled_modules: [],
      sdk_config_updated_at: null,
    });
  });

  it('updates on the expected version, bumps it and audits APP_SDK_CONFIG_UPDATE', async () => {
    const dto = await service.updateSdkConfig(
      SLUG,
      { expectedVersion: 1, disabledModules: ['retry_queue', 'header_propagation'] },
      ADMIN,
    );
    expect(dto.sdkConfig).toMatchObject({
      version: 2,
      disabledModules: ['header_propagation', 'retry_queue'],
    });
    expect(dto.sdkConfig.updatedAt).not.toBeNull();
    expect(await apps.findBySlug(SLUG)).toMatchObject({
      sdk_config_version: 2,
      sdk_disabled_modules: ['header_propagation', 'retry_queue'],
    });
    expect((await sdkConfigAudits()).map((row) => row.details)).toEqual([
      { slug: SLUG, version: 2, disabledModules: ['header_propagation', 'retry_queue'] },
    ]);
  });

  it('a stale expectedVersion is 409 CONFLICT: nothing changes and no audit row is written', async () => {
    await expect(
      service.updateSdkConfig(SLUG, { expectedVersion: 1, disabledModules: [] }, ADMIN),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.CONFLICT });
    expect(await apps.findBySlug(SLUG)).toMatchObject({
      sdk_config_version: 2,
      sdk_disabled_modules: ['header_propagation', 'retry_queue'],
    });
    expect(await sdkConfigAudits()).toHaveLength(1);
  });

  it('two admins racing on the same version: exactly one wins (conditional UPDATE)', async () => {
    const results = await Promise.allSettled([
      service.updateSdkConfig(SLUG, { expectedVersion: 2, disabledModules: ['custom'] }, ADMIN),
      service.updateSdkConfig(SLUG, { expectedVersion: 2, disabledModules: ['page_time'] }, ADMIN),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await apps.findBySlug(SLUG))?.sdk_config_version).toBe(3);
  });

  it('re-enabling everything is an empty list; an unknown slug is 404', async () => {
    const dto = await service.updateSdkConfig(
      SLUG,
      { expectedVersion: 3, disabledModules: [] },
      ADMIN,
    );
    expect(dto.sdkConfig).toMatchObject({ version: 4, disabledModules: [] });
    await expect(
      service.updateSdkConfig('no-such-app', { expectedVersion: 1, disabledModules: [] }, ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('the module CHECK refuses a value outside SDK_CAPTURE_MODULE_VALUES (defence in depth)', async () => {
    await expect(apps.updateSdkConfig(appId, ['everything' as never], 4)).rejects.toMatchObject({
      code: '23514',
    });
    expect((await apps.findBySlug(SLUG))?.sdk_config_version).toBe(4);
  });

  it('every app read carries the config (AppKeyCache → POST ingest.config sees it)', async () => {
    const [listed] = await apps.list();
    const byId = await apps.findById(appId);
    for (const row of [listed, byId]) {
      expect(row).toHaveProperty('sdk_config_version', 4);
      expect(row).toHaveProperty('sdk_disabled_modules', []);
    }
  });
});
