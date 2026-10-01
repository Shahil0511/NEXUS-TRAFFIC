import {
  appKeyParamsSchema,
  appSlugParamsSchema,
  createAppBodySchema,
  createKeyBodySchema,
  ERROR_CODES,
  expireKeyBodySchema,
  ROUTES,
  updateAppBodySchema,
  type ApiKeyDto,
  type AppDto,
  type CreateAppBody,
  type CreateKeyBody,
  type ExpireKeyBody,
  type KeyCreatedDto,
  type UpdateAppBody,
} from '@nexus/shared';
import express, { type Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { apiKeyRow, appRow, KEY_ID } from '../../../test/fixtures/app-rows';
import { recordingLogger } from '../../../test/fixtures/recording-logger';
import { mapApiKey, mapApp } from '../../domain/mappers';
import type { Viewer } from '../../domain/viewer';
import { NotFoundError } from '../../errors/app-error';
import type { AppAdminService } from '../../services/app-admin.service';
import type { AppQueryService } from '../../services/app-query.service';
import { errorHandlerMiddleware } from '../middleware/error-handler.middleware';
import { validateBody, validateParams } from '../middleware/validate.middleware';
import { AppController } from './app.controller';

const ADMIN: Viewer = { email: 'boss@libas.in', isAdmin: true };
const APP_DTO: AppDto = mapApp(appRow(), [apiKeyRow()]);
const KEY_DTO: ApiKeyDto = mapApiKey(apiKeyRow());
const SLUG = 'ebo-sales';

class FakeQuery implements Pick<AppQueryService, 'list'> {
  async list(): Promise<AppDto[]> {
    return [APP_DTO];
  }
}

class FakeAdmin implements Pick<
  AppAdminService,
  'create' | 'update' | 'createKey' | 'expireKey' | 'revokeKey'
> {
  readonly calls: unknown[][] = [];

  async create(body: CreateAppBody, actor: Viewer): Promise<AppDto> {
    this.calls.push(['create', body, actor]);
    return { ...APP_DTO, slug: body.slug, keys: [] };
  }

  async update(slug: string, body: UpdateAppBody, actor: Viewer): Promise<AppDto> {
    this.calls.push(['update', slug, body, actor]);
    if (slug !== SLUG) throw new NotFoundError(`App "${slug}" not found`);
    return APP_DTO;
  }

  async createKey(slug: string, body: CreateKeyBody, actor: Viewer): Promise<KeyCreatedDto> {
    this.calls.push(['createKey', slug, body, actor]);
    return { key: KEY_DTO, plaintextKey: `nx_sk_${'S'.repeat(40)}` };
  }

  async expireKey(
    slug: string,
    keyId: string,
    body: ExpireKeyBody,
    actor: Viewer,
  ): Promise<ApiKeyDto> {
    this.calls.push(['expireKey', slug, keyId, body, actor]);
    return { ...KEY_DTO, expiresAt: body.expiresAt };
  }

  async revokeKey(slug: string, keyId: string, actor: Viewer): Promise<ApiKeyDto> {
    this.calls.push(['revokeKey', slug, keyId, actor]);
    return { ...KEY_DTO, revokedAt: '2026-10-01T10:00:00.000Z' };
  }
}

/** A tiny app wired like the real route table (viewer → validate → controller → error handler). */
function buildApp(admin: FakeAdmin): Express {
  const ctl = new AppController(
    new FakeQuery() as unknown as AppQueryService,
    admin as unknown as AppAdminService,
  );
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.viewer = ADMIN;
    next();
  });
  app.get(ROUTES.apps.list.path, ctl.list);
  app.post(ROUTES.apps.create.path, validateBody(createAppBodySchema), ctl.create);
  app.patch(
    ROUTES.apps.update.path,
    validateParams(appSlugParamsSchema),
    validateBody(updateAppBodySchema),
    ctl.update,
  );
  app.post(
    ROUTES.apps.createKey.path,
    validateParams(appSlugParamsSchema),
    validateBody(createKeyBodySchema),
    ctl.createKey,
  );
  app.patch(
    ROUTES.apps.expireKey.path,
    validateParams(appKeyParamsSchema),
    validateBody(expireKeyBodySchema),
    ctl.expireKey,
  );
  app.delete(ROUTES.apps.revokeKey.path, validateParams(appKeyParamsSchema), ctl.revokeKey);
  app.use(errorHandlerMiddleware(recordingLogger().logger));
  return app;
}

const appPath = (slug: string) => ROUTES.apps.update.path.replace(':slug', slug);
const keysPath = (slug: string) => ROUTES.apps.createKey.path.replace(':slug', slug);
const keyPath = (slug: string, keyId: string) =>
  ROUTES.apps.expireKey.path.replace(':slug', slug).replace(':keyId', keyId);

describe('AppController', () => {
  let admin: FakeAdmin;
  let app: Express;
  beforeEach(() => {
    admin = new FakeAdmin();
    app = buildApp(admin);
  });

  it('list → 200 with the apps', async () => {
    const res = await request(app).get(ROUTES.apps.list.path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([APP_DTO]);
  });

  it('create → 201 with zod defaults applied and the viewer as actor', async () => {
    const res = await request(app)
      .post(ROUTES.apps.create.path)
      .send({ slug: 'new-app', displayName: ' New ' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('new-app');
    expect(admin.calls[0]).toEqual([
      'create',
      {
        slug: 'new-app',
        displayName: 'New',
        basePath: null,
        allowedOrigins: [],
        browserIngestEnabled: true,
      },
      ADMIN,
    ]);
  });

  it('create → 400 VALIDATION_ERROR on an invalid body (service not called)', async () => {
    const res = await request(app).post(ROUTES.apps.create.path).send({ slug: 'Bad Slug!' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    expect(admin.calls).toEqual([]);
  });

  it('update → 200 and passes slug + body', async () => {
    const res = await request(app).patch(appPath(SLUG)).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(admin.calls[0]).toEqual(['update', SLUG, { isActive: false }, ADMIN]);
  });

  it('update → service NotFoundError renders 404', async () => {
    const res = await request(app).patch(appPath('other-app')).send({ isActive: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it('createKey → 201, no-store, plaintext returned', async () => {
    const res = await request(app).post(keysPath(SLUG)).send({ kind: 'secret', label: 'prod' });
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.plaintextKey).toMatch(/^nx_sk_/);
    expect(admin.calls[0]).toEqual(['createKey', SLUG, { kind: 'secret', label: 'prod' }, ADMIN]);
  });

  it('expireKey → 200', async () => {
    const expiresAt = '2026-10-08T10:00:00.000Z';
    const res = await request(app).patch(keyPath(SLUG, KEY_ID)).send({ expiresAt });
    expect(res.status).toBe(200);
    expect(res.body.expiresAt).toBe(expiresAt);
    expect(admin.calls[0]).toEqual(['expireKey', SLUG, KEY_ID, { expiresAt }, ADMIN]);
  });

  it('revokeKey → 200; a non-uuid key id is a 400', async () => {
    const ok = await request(app).delete(keyPath(SLUG, KEY_ID));
    expect(ok.status).toBe(200);
    expect(ok.body.revokedAt).not.toBeNull();
    expect(admin.calls[0]).toEqual(['revokeKey', SLUG, KEY_ID, ADMIN]);

    const bad = await request(app).delete(keyPath(SLUG, 'not-a-uuid'));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
  });
});
