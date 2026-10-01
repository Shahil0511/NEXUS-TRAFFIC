/**
 * Data access for `traffic.api_keys`.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { NewApiKey } from '../domain/inserts';
import type { ApiKeyRow } from '../domain/rows';
import { notImplemented } from '../lib/not-implemented';

export class ApiKeyRepository {
  constructor(private readonly db: Pool) {}

  /** Lookup by the stored 14-char prefix (unique). Returns revoked/expired keys too — the caller decides. */
  async findByPrefix(keyPrefix: string, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    void keyPrefix;
    void exec;
    throw notImplemented('ApiKeyRepository.findByPrefix');
  }

  /** All keys of the given apps, newest first. */
  async listByAppIds(appIds: string[], exec: Executor = this.db): Promise<ApiKeyRow[]> {
    void appIds;
    void exec;
    throw notImplemented('ApiKeyRepository.listByAppIds');
  }

  async insert(key: NewApiKey, exec: Executor = this.db): Promise<ApiKeyRow> {
    void key;
    void exec;
    throw notImplemented('ApiKeyRepository.insert');
  }

  /** Sets expires_at on a non-revoked key of that app. Null when no such key. */
  async setExpiry(id: string, appId: string, expiresAt: Date, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    void id;
    void appId;
    void expiresAt;
    void exec;
    throw notImplemented('ApiKeyRepository.setExpiry');
  }

  /** Sets revoked_at/revoked_by (idempotent: keeps the first revocation). Null when no such key. */
  async revoke(id: string, appId: string, revokedBy: string, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    void id;
    void appId;
    void revokedBy;
    void exec;
    throw notImplemented('ApiKeyRepository.revoke');
  }

  /** Flags a secret key that was sent to the browser endpoint (keeps the first timestamp). */
  async markExposed(id: string, exec: Executor = this.db): Promise<void> {
    void id;
    void exec;
    throw notImplemented('ApiKeyRepository.markExposed');
  }

  /** Updates last_used_at / last_sdk at most once per minute per key (WHERE-guarded, cheap). */
  async touchUsage(id: string, sdk: string | null, exec: Executor = this.db): Promise<void> {
    void id;
    void sdk;
    void exec;
    throw notImplemented('ApiKeyRepository.touchUsage');
  }
}
