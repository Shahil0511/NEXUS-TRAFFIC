/**
 * The migrate runner end to end against a real Postgres: fresh apply, no-op re-run, drift,
 * unknown-applied (rollback), dry/status modes, failed apply rollback, bootstrap idempotency and
 * password rotation, the nexus_app grants re-applied on every run (DB_APP_ROLE_MODE=separate), the
 * owner mode of the shared server (ADR 0002: no role created or altered, the api runs as the owner),
 * and the api's SchemaGuard.
 */
import { randomBytes } from 'node:crypto';
import { appendFile, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapDatabase } from '../../src/db/migration-runner/bootstrap';
import { readLedger } from '../../src/db/migration-runner/ledger';
import { MIGRATE_EXIT_CODES, runMigrations, type MigrateMode } from '../../src/db/migration-runner/runner';
import { SchemaGuard, SchemaNotCurrentError } from '../../src/db/migration-runner/schema-guard';
import { createWritePool } from '../../src/db/pool';
import { APP_ROLE, MIGRATIONS_DIR } from '../../src/db/schema';
import { AdminAuditRepository } from '../../src/repositories/admin-audit.repository';
import { AppRepository } from '../../src/repositories/app.repository';
import { PartitionRepository } from '../../src/repositories/partition.repository';
import {
  RUN_DB_TESTS,
  TEST_ADMIN_URL,
  TEST_APP_PASSWORD,
  TEST_APP_ROLE,
  caught,
  createTestDatabase,
  databaseUrl,
  quietLogger,
  type TestDatabase,
} from './test-database';

const ALL_MIGRATIONS = [
  '0001_helpers_and_partitions',
  '0002_apps_and_api_keys',
  '0003_admin_audit_log',
  '0004_api_requests',
  '0005_web_events',
  '0006_ingest_counters',
];

const separate = (password: string) => ({ mode: 'separate', password }) as const;

describe.skipIf(!RUN_DB_TESTS)('migration runner (db)', () => {
  let db: TestDatabase;
  const tempDirs: string[] = [];

  /** Copies the real migrations (optionally only the first `count`) into a temp dir. */
  async function copyMigrations(count?: number): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'nexus-migrations-'));
    tempDirs.push(dir);
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files.slice(0, count ?? files.length)) {
      await copyFile(path.join(MIGRATIONS_DIR, file), path.join(dir, file));
    }
    return dir;
  }

  const run = (migrationsDir: string, mode: MigrateMode = 'apply') =>
    runMigrations({ pool: db.ownerPool, migrationsDir, appRole: TEST_APP_ROLE, mode, logger: quietLogger });

  async function canConnectAsApp(password: string): Promise<boolean> {
    const client = new Client({ connectionString: databaseUrl(db.name, { user: APP_ROLE, password }) });
    try {
      await client.connect();
      await client.end();
      return true;
    } catch {
      return false;
    }
  }

  /** has_table_privilege for nexus_app, read as the owner. */
  async function appCan(table: string, privilege: string): Promise<boolean> {
    const { rows } = await db.ownerPool.query<{ ok: boolean }>('SELECT has_table_privilege($1, $2, $3) AS ok', [
      APP_ROLE,
      table,
      privilege,
    ]);
    return rows[0]?.ok === true;
  }

  /** Default-privilege entries in schema traffic (must not grow when the grants are re-applied). */
  async function defaultAclCount(): Promise<number> {
    const { rows } = await db.ownerPool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_catalog.pg_default_acl WHERE defaclnamespace = 'traffic'::regnamespace`,
    );
    return rows[0]?.n ?? -1;
  }

  beforeAll(async () => {
    db = await createTestDatabase('runner', { migrate: false });
  });

  afterAll(async () => {
    await db?.drop();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reports everything pending on an empty database (guard + status mode, no side effects)', async () => {
    const guard = new SchemaGuard(db.ownerPool, MIGRATIONS_DIR);
    expect(await guard.check()).toEqual({ pending: ALL_MIGRATIONS, drifted: [], unknownApplied: [] });
    await expect(guard.assertCurrent(quietLogger)).rejects.toBeInstanceOf(SchemaNotCurrentError);

    const status = await run(MIGRATIONS_DIR, 'status');
    expect(status.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(status.applied).toEqual([]);
    const { rows } = await db.ownerPool.query(`SELECT to_regnamespace('traffic') IS NULL AS absent`);
    expect(rows[0].absent).toBe(true);
  });

  it('applies every migration on a fresh database and creates the partitions', async () => {
    const result = await run(MIGRATIONS_DIR);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual(ALL_MIGRATIONS);
    // 1 month back + current + 2 ahead, for both tables.
    expect(result.partitions).toHaveLength(8);
    const ledger = await readLedger(db.ownerPool);
    expect(ledger.map((m) => `${m.version}_${m.name}`)).toEqual(ALL_MIGRATIONS);
    expect(ledger.every((m) => /^[0-9a-f]{64}$/.test(m.checksum))).toBe(true);
  });

  it('lets the api guard (as nexus_app) see a current schema', async () => {
    const guard = new SchemaGuard(db.appPool, MIGRATIONS_DIR);
    await expect(guard.assertCurrent(quietLogger)).resolves.toBeUndefined();
  });

  it('is a no-op when re-run', async () => {
    const result = await run(MIGRATIONS_DIR);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual([]);
    expect(result.plan.pending).toEqual([]);
    expect(await readLedger(db.ownerPool)).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('re-applies the nexus_app grants idempotently on every run (separate mode)', async () => {
    const aclBefore = await defaultAclCount();
    expect(aclBefore).toBe(2); // tables + sequences
    await db.ownerPool.query(`REVOKE INSERT ON traffic.apps FROM ${APP_ROLE}`);
    expect(await appCan('traffic.apps', 'INSERT')).toBe(false);

    const first = await run(MIGRATIONS_DIR);
    expect(first.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(first.applied).toEqual([]);
    expect(await appCan('traffic.apps', 'INSERT')).toBe(true);

    const second = await run(MIGRATIONS_DIR);
    expect(second.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(await defaultAclCount()).toBe(aclBefore);
    // Still DML only and an append-only audit log after the re-runs.
    expect(await appCan('traffic.admin_audit_log', 'UPDATE')).toBe(false);
    expect(await appCan('traffic.apps', 'TRUNCATE')).toBe(false);
  });

  it('status and dry runs never touch the grants', async () => {
    await db.ownerPool.query(`REVOKE DELETE ON traffic.ingest_counters FROM ${APP_ROLE}`);
    try {
      await run(MIGRATIONS_DIR, 'status');
      await run(MIGRATIONS_DIR, 'dry');
      expect(await appCan('traffic.ingest_counters', 'DELETE')).toBe(false);
    } finally {
      await run(MIGRATIONS_DIR);
    }
    expect(await appCan('traffic.ingest_counters', 'DELETE')).toBe(true);
  });

  it('bootstrap is idempotent and rotates the nexus_app password', async () => {
    const rotated = 'rotated-test-password-0002';
    try {
      await bootstrapDatabase(db.ownerPool, separate(rotated));
      await bootstrapDatabase(db.ownerPool, separate(rotated));
      expect(await canConnectAsApp(rotated)).toBe(true);
      expect(await canConnectAsApp(TEST_APP_PASSWORD)).toBe(false);
    } finally {
      await bootstrapDatabase(db.ownerPool, TEST_APP_ROLE);
    }
    expect(await canConnectAsApp(TEST_APP_PASSWORD)).toBe(true);
    // Bootstrap never touches the ledger or the schema contents.
    expect(await readLedger(db.ownerPool)).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('quotes passwords safely (quotes and backslashes are data, not SQL)', async () => {
    const tricky = `pa'ss"word\\x; DROP ROLE ${APP_ROLE}; --`;
    try {
      await bootstrapDatabase(db.ownerPool, separate(tricky));
      expect(await canConnectAsApp(tricky)).toBe(true);
    } finally {
      await bootstrapDatabase(db.ownerPool, TEST_APP_ROLE);
    }
  });

  it('rejects a short password before touching the role', async () => {
    const err = await caught(() => bootstrapDatabase(db.ownerPool, separate('short')));
    expect(err.message).toMatch(/at least 16/);
  });

  it('detects checksum drift, exits non-zero and applies nothing', async () => {
    const dir = await copyMigrations();
    await appendFile(path.join(dir, '0003_admin_audit_log.sql'), '\n-- edited after apply\n');
    await writeFile(path.join(dir, '0007_never_applied.sql'), 'CREATE TABLE traffic.should_not_exist (id int);\n');

    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.drift);
    expect(result.plan.drifted.map((d) => d.file.fileName)).toEqual(['0003_admin_audit_log.sql']);
    expect(result.applied).toEqual([]);

    const guard = new SchemaGuard(db.appPool, dir);
    expect((await guard.check()).drifted).toEqual(['0003_admin_audit_log']);
    await expect(guard.assertCurrent(quietLogger)).rejects.toBeInstanceOf(SchemaNotCurrentError);
  });

  it('treats CRLF line endings and a BOM as the same file (no drift)', async () => {
    const dir = await copyMigrations();
    const file = path.join(dir, '0006_ingest_counters.sql');
    const lf = await readFile(file, 'utf8');
    await writeFile(file, `﻿${lf.replace(/\n/g, '\r\n')}`);
    const result = await run(dir, 'status');
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.plan.drifted).toEqual([]);
  });

  it('warns but exits 0 when the database knows migrations the code does not (rollback)', async () => {
    const dir = await copyMigrations(4);
    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.plan.unknownApplied.map((m) => m.version)).toEqual(['0005', '0006']);
    expect(result.plan.pending).toEqual([]);

    const guard = new SchemaGuard(db.appPool, dir);
    const status = await guard.check();
    expect(status.unknownApplied).toEqual(['0005_web_events', '0006_ingest_counters']);
    await expect(guard.assertCurrent(quietLogger)).resolves.toBeUndefined();
  });

  it('dry mode lists pending files without applying them', async () => {
    const dir = await copyMigrations();
    await writeFile(path.join(dir, '0007_extra.sql'), '-- intent: test\nCREATE TABLE traffic.dry_extra (id int);\n');
    const result = await run(dir, 'dry');
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.plan.pending.map((f) => f.fileName)).toEqual(['0007_extra.sql']);
    expect(result.applied).toEqual([]);
    const { rows } = await db.ownerPool.query(`SELECT to_regclass('traffic.dry_extra') IS NULL AS absent`);
    expect(rows[0].absent).toBe(true);
  });

  it('rolls back a failing migration completely and exits non-zero', async () => {
    const dir = await copyMigrations();
    await writeFile(
      path.join(dir, '0007_broken.sql'),
      '-- intent: test\nCREATE TABLE traffic.half_done (id int);\nSELECT 1 / 0;\n',
    );
    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.failed);
    expect(result.applied).toEqual([]);
    const { rows } = await db.ownerPool.query(`SELECT to_regclass('traffic.half_done') IS NULL AS absent`);
    expect(rows[0].absent).toBe(true);
    expect(await readLedger(db.ownerPool)).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('applies a new migration and the default privileges cover its table for nexus_app', async () => {
    const dir = await copyMigrations();
    await writeFile(
      path.join(dir, '0007_future_table.sql'),
      '-- intent: test\nCREATE TABLE traffic.future_table (id int GENERATED ALWAYS AS IDENTITY, note text);\n',
    );
    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual(['0007_future_table']);
    await db.appPool.query(`INSERT INTO traffic.future_table (note) VALUES ('ok')`);
    const { rows } = await db.appPool.query(`SELECT count(*)::int AS n FROM traffic.future_table`);
    expect(rows[0].n).toBe(1);
  });
});

// ─── DB_APP_ROLE_MODE=owner (ADR 0002: the shared server) ───────────────────

describe.skipIf(!RUN_DB_TESTS)('migration runner in owner mode (db)', () => {
  /** Like the shared server's login: owns its database, CREATEDB, but NO CREATEROLE and no superuser. */
  const login = `nx_test_owner_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(16).toString('hex');
  const database = `nx_test_ownermode_${randomBytes(4).toString('hex')}`;
  const ownerUrl = databaseUrl(database, { user: login, password });
  let ownerPool: Pool;
  /** The api's write pool built from the SAME login (DATABASE_URL = MIGRATION_DATABASE_URL). */
  let apiPool: Pool;

  const runOwner = () =>
    runMigrations({
      pool: ownerPool,
      migrationsDir: MIGRATIONS_DIR,
      appRole: { mode: 'owner' },
      mode: 'apply',
      logger: quietLogger,
    });

  async function asAdmin(sql: string): Promise<void> {
    const client = new Client({ connectionString: TEST_ADMIN_URL });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }

  async function countOf(sql: string): Promise<number> {
    const { rows } = await ownerPool.query<{ n: number }>(sql);
    return rows[0]?.n ?? -1;
  }

  beforeAll(async () => {
    // Identifiers and the hex password are generated above (safe to inline).
    await asAdmin(`CREATE ROLE ${login} LOGIN CREATEDB NOCREATEROLE NOSUPERUSER PASSWORD '${password}'`);
    await asAdmin(`CREATE DATABASE "${database}" OWNER ${login}`);
    ownerPool = new Pool({ connectionString: ownerUrl, max: 2, application_name: 'nexus-test-ownermode' });
    apiPool = createWritePool(ownerUrl, 2, quietLogger);
  });

  afterAll(async () => {
    await Promise.allSettled([ownerPool?.end(), apiPool?.end()]);
    await asAdmin(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await asAdmin(`DROP ROLE IF EXISTS ${login}`);
  });

  it('bootstraps schema + ledger and applies everything without creating or altering any role', async () => {
    // The login has no CREATEROLE, so any CREATE/ALTER ROLE would make this run throw.
    const result = await runOwner();
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual(ALL_MIGRATIONS);
    expect(result.partitions).toHaveLength(8);
    expect((await readLedger(ownerPool)).map((m) => `${m.version}_${m.name}`)).toEqual(ALL_MIGRATIONS);

    // grants.ts did not run: no table grant to anyone but the owner, no default privileges.
    expect(
      await countOf(
        `SELECT count(*)::int AS n
           FROM pg_catalog.pg_class c, aclexplode(c.relacl) acl
          WHERE c.relnamespace = 'traffic'::regnamespace AND acl.grantee <> c.relowner`,
      ),
    ).toBe(0);
    expect(
      await countOf(
        `SELECT count(*)::int AS n FROM pg_catalog.pg_default_acl WHERE defaclnamespace = 'traffic'::regnamespace`,
      ),
    ).toBe(0);

    const { rows } = await ownerPool.query<{ rolcreaterole: boolean; rolsuper: boolean }>(
      'SELECT rolcreaterole, rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolcreaterole: false, rolsuper: false });
  });

  it('is a no-op when re-run', async () => {
    const result = await runOwner();
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual([]);
  });

  it('lets the api run as the owner: schema guard, admin writes, partition functions', async () => {
    await expect(new SchemaGuard(apiPool, MIGRATIONS_DIR).assertCurrent(quietLogger)).resolves.toBeUndefined();

    const app = await new AppRepository(apiPool).insert({
      slug: 'owner-mode-app',
      displayName: 'Owner mode',
      basePath: null,
      allowedOrigins: [],
      browserIngestEnabled: false,
      createdBy: 'admin@libas.in',
    });
    await new AdminAuditRepository(apiPool).record({
      actorEmail: 'admin@libas.in',
      action: 'APP_CREATE',
      targetType: 'app',
      targetId: app.id,
    });
    const partitions = new PartitionRepository(apiPool);
    expect(await partitions.ensure(1, 2)).toHaveLength(8);
    expect(await partitions.dropExpired('api_requests', 6)).toEqual([]);
    expect(await countOf('SELECT count(*)::int AS n FROM traffic.admin_audit_log')).toBe(1);
  });
});
