/**
 * Data access for `traffic.apps`.
 * @see ../../migrations/0002_apps_and_api_keys.sql
 */
import type { Pool } from 'pg';

import type { Executor } from '../db/executor';
import { ParamList } from '../db/sql';
import type { AppPatch, NewApp } from '../domain/inserts';
import type { AppRow } from '../domain/rows';

/** Every column of AppRow, in table order. */
const APP_COLUMNS = `id, slug, display_name, base_path, allowed_origins, is_active,
  browser_ingest_enabled, created_by, created_at, updated_at`;

/** AppPatch field → column. The ONLY identifiers an UPDATE may touch (whitelist). */
const PATCH_COLUMNS = {
  displayName: 'display_name',
  basePath: 'base_path',
  allowedOrigins: 'allowed_origins',
  browserIngestEnabled: 'browser_ingest_enabled',
  isActive: 'is_active',
} as const satisfies Record<keyof AppPatch, string>;

/** `SET col = $n, …` for the fields present in `patch` (undefined = not provided). */
export function buildAppPatchSet(patch: AppPatch, params: ParamList): string[] {
  return (Object.keys(PATCH_COLUMNS) as (keyof AppPatch)[])
    .filter((field) => patch[field] !== undefined)
    .map((field) => `${PATCH_COLUMNS[field]} = ${params.add(patch[field])}`);
}

export class AppRepository {
  constructor(private readonly db: Pool) {}

  async findById(id: string, exec: Executor = this.db): Promise<AppRow | null> {
    const { rows } = await exec.query<AppRow>(`SELECT ${APP_COLUMNS} FROM traffic.apps WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findBySlug(slug: string, exec: Executor = this.db): Promise<AppRow | null> {
    const { rows } = await exec.query<AppRow>(`SELECT ${APP_COLUMNS} FROM traffic.apps WHERE slug = $1`, [slug]);
    return rows[0] ?? null;
  }

  /**
   * True when an active app with browser ingest enabled lists `origin` in allowed_origins.
   * Used ONLY by the browser-ingest CORS preflight, which cannot know the app (no body yet).
   */
  async anyAllowsOrigin(origin: string, exec: Executor = this.db): Promise<boolean> {
    const { rows } = await exec.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM traffic.apps
          WHERE is_active AND browser_ingest_enabled
            AND lower($1) IN (SELECT lower(o) FROM unnest(allowed_origins) AS o)
       ) AS allowed`,
      [origin],
    );
    return rows[0]?.allowed ?? false;
  }

  /** All apps ordered by slug. */
  async list(exec: Executor = this.db): Promise<AppRow[]> {
    const { rows } = await exec.query<AppRow>(`SELECT ${APP_COLUMNS} FROM traffic.apps ORDER BY slug`);
    return rows;
  }

  /** Throws a unique-violation (23505) when the slug exists — the service maps it to 409. */
  async insert(app: NewApp, exec: Executor = this.db): Promise<AppRow> {
    const { rows } = await exec.query<AppRow>(
      `INSERT INTO traffic.apps
         (slug, display_name, base_path, allowed_origins, browser_ingest_enabled, created_by)
       VALUES ($1, $2, $3, $4::text[], $5, $6)
       RETURNING ${APP_COLUMNS}`,
      [app.slug, app.displayName, app.basePath, app.allowedOrigins, app.browserIngestEnabled, app.createdBy],
    );
    return firstRow(rows);
  }

  /** Applies only the provided fields; returns null when the app does not exist. */
  async update(id: string, patch: AppPatch, exec: Executor = this.db): Promise<AppRow | null> {
    const params = new ParamList();
    const assignments = buildAppPatchSet(patch, params);
    if (assignments.length === 0) return this.findById(id, exec);
    const { rows } = await exec.query<AppRow>(
      `UPDATE traffic.apps SET ${assignments.join(', ')}
        WHERE id = ${params.add(id)}
       RETURNING ${APP_COLUMNS}`,
      params.values,
    );
    return rows[0] ?? null;
  }
}

/** INSERT … RETURNING always yields one row; narrows the type for noUncheckedIndexedAccess. */
function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (!row) throw new Error('INSERT … RETURNING returned no row');
  return row;
}
