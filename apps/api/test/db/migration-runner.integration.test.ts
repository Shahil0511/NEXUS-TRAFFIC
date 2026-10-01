/**
 * The migrate runner end to end against a real Postgres: fresh apply, no-op re-run, drift,
 * unknown-applied (rollback), dry/status modes, failed apply rollback, bootstrap idempotency and
 * password rotation, and the api's SchemaGuard.
 */
import { appendFile, copyFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootstrapDatabase } from '../../src/db/migration-runner/bootstrap';
import { readLedger } from '../../src/db/migration-runner/ledger';
import { MIGRATE_EXIT_CODES, runMigrations, type MigrateMode } from '../../src/db/migration-runner/runner';
import { SchemaGuard, SchemaNotCurrentError } from '../../src/db/migration-runner/schema-guard';
import { APP_ROLE, MIGRATIONS_DIR } from '../../src/db/schema';
import {
  RUN_DB_TESTS,
  TEST_APP_PASSWORD,
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
  '0007_grants',
];

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
    runMigrations({ pool: db.ownerPool, migrationsDir, appPassword: TEST_APP_PASSWORD, mode, logger: quietLogger });

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

  it('bootstrap is idempotent and rotates the nexus_app password', async () => {
    const rotated = 'rotated-test-password-0002';
    try {
      await bootstrapDatabase(db.ownerPool, rotated);
      await bootstrapDatabase(db.ownerPool, rotated);
      expect(await canConnectAsApp(rotated)).toBe(true);
      expect(await canConnectAsApp(TEST_APP_PASSWORD)).toBe(false);
    } finally {
      await bootstrapDatabase(db.ownerPool, TEST_APP_PASSWORD);
    }
    expect(await canConnectAsApp(TEST_APP_PASSWORD)).toBe(true);
    // Bootstrap never touches the ledger or the schema contents.
    expect(await readLedger(db.ownerPool)).toHaveLength(ALL_MIGRATIONS.length);
  });

  it('quotes passwords safely (quotes and backslashes are data, not SQL)', async () => {
    const tricky = `pa'ss"word\\x; DROP ROLE ${APP_ROLE}; --`;
    try {
      await bootstrapDatabase(db.ownerPool, tricky);
      expect(await canConnectAsApp(tricky)).toBe(true);
    } finally {
      await bootstrapDatabase(db.ownerPool, TEST_APP_PASSWORD);
    }
  });

  it('rejects a short password before touching the role', async () => {
    const err = await caught(() => bootstrapDatabase(db.ownerPool, 'short'));
    expect(err.message).toMatch(/at least 16/);
  });

  it('detects checksum drift, exits non-zero and applies nothing', async () => {
    const dir = await copyMigrations();
    await appendFile(path.join(dir, '0003_admin_audit_log.sql'), '\n-- edited after apply\n');
    await writeFile(path.join(dir, '0008_never_applied.sql'), 'CREATE TABLE traffic.should_not_exist (id int);\n');

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
    const dir = await copyMigrations(5);
    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.plan.unknownApplied.map((m) => m.version)).toEqual(['0006', '0007']);
    expect(result.plan.pending).toEqual([]);

    const guard = new SchemaGuard(db.appPool, dir);
    const status = await guard.check();
    expect(status.unknownApplied).toEqual(['0006_ingest_counters', '0007_grants']);
    await expect(guard.assertCurrent(quietLogger)).resolves.toBeUndefined();
  });

  it('dry mode lists pending files without applying them', async () => {
    const dir = await copyMigrations();
    await writeFile(path.join(dir, '0008_extra.sql'), '-- intent: test\nCREATE TABLE traffic.dry_extra (id int);\n');
    const result = await run(dir, 'dry');
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.plan.pending.map((f) => f.fileName)).toEqual(['0008_extra.sql']);
    expect(result.applied).toEqual([]);
    const { rows } = await db.ownerPool.query(`SELECT to_regclass('traffic.dry_extra') IS NULL AS absent`);
    expect(rows[0].absent).toBe(true);
  });

  it('rolls back a failing migration completely and exits non-zero', async () => {
    const dir = await copyMigrations();
    await writeFile(
      path.join(dir, '0008_broken.sql'),
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
      path.join(dir, '0008_future_table.sql'),
      '-- intent: test\nCREATE TABLE traffic.future_table (id int GENERATED ALWAYS AS IDENTITY, note text);\n',
    );
    const result = await run(dir);
    expect(result.exitCode).toBe(MIGRATE_EXIT_CODES.ok);
    expect(result.applied).toEqual(['0008_future_table']);
    await db.appPool.query(`INSERT INTO traffic.future_table (note) VALUES ('ok')`);
    const { rows } = await db.appPool.query(`SELECT count(*)::int AS n FROM traffic.future_table`);
    expect(rows[0].n).toBe(1);
  });
});
