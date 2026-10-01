/**
 * Write side of app management (admins only). Every mutation runs in a transaction with its
 * audit row, then invalidates the key cache so revocations take effect on the next request.
 */
import type {
  ApiKeyDto,
  AppCreatedDto,
  AppDto,
  CreateAppBody,
  CreateKeyBody,
  ExpireKeyBody,
  KeyCreatedDto,
  UpdateAppBody,
} from '@nexus/shared';
import type { Pool } from 'pg';

import type { ApiKeyGenerator } from '../auth/api-key.generator';
import type { AppKeyCache } from '../auth/app-key.cache';
import type { Viewer } from '../domain/viewer';
import { notImplemented } from '../lib/not-implemented';
import type { AdminAuditRepository } from '../repositories/admin-audit.repository';
import type { ApiKeyRepository } from '../repositories/api-key.repository';
import type { AppRepository } from '../repositories/app.repository';

export class AppAdminService {
  constructor(
    private readonly db: Pool,
    private readonly apps: AppRepository,
    private readonly apiKeys: ApiKeyRepository,
    private readonly audit: AdminAuditRepository,
    private readonly generator: ApiKeyGenerator,
    private readonly keyCache: AppKeyCache,
  ) {}

  /** 409 when the slug exists. Audit: APP_CREATE. */
  async create(body: CreateAppBody, actor: Viewer): Promise<AppCreatedDto> {
    void body;
    void actor;
    void this.db;
    void this.apps;
    void this.apiKeys;
    void this.audit;
    void this.generator;
    void this.keyCache;
    throw notImplemented('AppAdminService.create');
  }

  /** 404 unknown slug. Audit: APP_UPDATE (or APP_DISABLE when isActive becomes false). */
  async update(slug: string, body: UpdateAppBody, actor: Viewer): Promise<AppDto> {
    void slug;
    void body;
    void actor;
    throw notImplemented('AppAdminService.update');
  }

  /** Returns the plaintext key ONCE. Audit: KEY_CREATE. */
  async createKey(slug: string, body: CreateKeyBody, actor: Viewer): Promise<KeyCreatedDto> {
    void slug;
    void body;
    void actor;
    throw notImplemented('AppAdminService.createKey');
  }

  /** Rotation grace: set expires_at (must be in the future). Audit: KEY_EXPIRE. */
  async expireKey(slug: string, keyId: string, body: ExpireKeyBody, actor: Viewer): Promise<ApiKeyDto> {
    void slug;
    void keyId;
    void body;
    void actor;
    throw notImplemented('AppAdminService.expireKey');
  }

  /** Immediate revocation. Audit: KEY_REVOKE. */
  async revokeKey(slug: string, keyId: string, actor: Viewer): Promise<ApiKeyDto> {
    void slug;
    void keyId;
    void actor;
    throw notImplemented('AppAdminService.revokeKey');
  }
}
