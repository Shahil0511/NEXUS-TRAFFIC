/**
 * Data access for `traffic.api_keys`.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import type { NewApiKey } from '../domain/inserts';
import type { ApiKeyRow } from '../domain/rows';

/** Every column of ApiKeyRow, in table order. */
const API_KEY_COLUMNS = `id, app_id, kind, key_prefix, key_hash, public_key, label, created_by,
  created_at, expires_at, last_used_at, last_sdk, exposed_at, revoked_at, revoked_by`;

export class ApiKeyRepository {
  constructor(private readonly db: Pool) {}

  /** Lookup by the stored 14-char prefix (unique). Returns revoked/expired keys too — the caller decides. */
  async findByPrefix(keyPrefix: string, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    const { rows } = await exec.query<ApiKeyRow>(
      `SELECT ${API_KEY_COLUMNS} FROM traffic.api_keys WHERE key_prefix = $1`,
      [keyPrefix],
    );
    return rows[0] ?? null;
  }

  /** All keys of the given apps, newest first. */
  async listByAppIds(appIds: string[], exec: Executor = this.db): Promise<ApiKeyRow[]> {
    if (appIds.length === 0) return [];
    const { rows } = await exec.query<ApiKeyRow>(
      `SELECT ${API_KEY_COLUMNS} FROM traffic.api_keys
        WHERE app_id = ANY($1::uuid[])
        ORDER BY created_at DESC, id`,
      [appIds],
    );
    return rows;
  }

  async insert(key: NewApiKey, exec: Executor = this.db): Promise<ApiKeyRow> {
    const { rows } = await exec.query<ApiKeyRow>(
      `INSERT INTO traffic.api_keys (app_id, kind, key_prefix, key_hash, public_key, label, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${API_KEY_COLUMNS}`,
      [key.appId, key.kind, key.keyPrefix, key.keyHash, key.publicKey, key.label, key.createdBy],
    );
    const row = rows[0];
    if (!row) throw new Error('INSERT … RETURNING returned no row');
    return row;
  }

  /** Sets expires_at on a non-revoked key of that app. Null when no such key. */
  async setExpiry(id: string, appId: string, expiresAt: Date, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    const { rows } = await exec.query<ApiKeyRow>(
      `UPDATE traffic.api_keys SET expires_at = $3
        WHERE id = $1 AND app_id = $2 AND revoked_at IS NULL
       RETURNING ${API_KEY_COLUMNS}`,
      [id, appId, expiresAt],
    );
    return rows[0] ?? null;
  }

  /** Sets revoked_at/revoked_by (idempotent: keeps the first revocation). Null when no such key. */
  async revoke(id: string, appId: string, revokedBy: string, exec: Executor = this.db): Promise<ApiKeyRow | null> {
    const { rows } = await exec.query<ApiKeyRow>(
      `UPDATE traffic.api_keys
          SET revoked_at = COALESCE(revoked_at, now()),
              revoked_by = COALESCE(revoked_by, $3)
        WHERE id = $1 AND app_id = $2
       RETURNING ${API_KEY_COLUMNS}`,
      [id, appId, revokedBy],
    );
    return rows[0] ?? null;
  }

  /** Flags a secret key that was sent to the browser endpoint (keeps the first timestamp). */
  async markExposed(id: string, exec: Executor = this.db): Promise<void> {
    await exec.query(`UPDATE traffic.api_keys SET exposed_at = now() WHERE id = $1 AND exposed_at IS NULL`, [id]);
  }

  /** Updates last_used_at / last_sdk at most once per minute per key (WHERE-guarded, cheap). */
  async touchUsage(id: string, sdk: string | null, exec: Executor = this.db): Promise<void> {
    await exec.query(
      `UPDATE traffic.api_keys
          SET last_used_at = now(),
              last_sdk = COALESCE($2, last_sdk)
        WHERE id = $1
          AND (last_used_at IS NULL OR last_used_at < now() - INTERVAL '1 minute')`,
      [id, sdk],
    );
  }
}
