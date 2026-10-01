/**
 * Reads the migration files from disk and fingerprints them.
 *
 * WHY normalise before hashing: the same file checked out on Windows (CRLF, maybe a BOM) and on
 * the Linux server (LF) must produce the SAME checksum, or every deploy would report drift.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** `NNNN_snake_case.sql` — the 4-digit prefix is the version, the rest the name. */
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

/** One migration file, ready to apply. */
export interface MigrationFile {
  /** '0004' */
  version: string;
  /** 'api_requests' */
  name: string;
  /** '0004_api_requests.sql' */
  fileName: string;
  /** Normalised SQL text (LF line endings, no BOM). */
  sql: string;
  /** sha256 hex of `sql`. */
  checksum: string;
}

/** WHY: a broken name or two files sharing a version must stop the deploy, never be skipped. */
export class MigrationFileError extends Error {}

/** Strips a UTF-8 BOM and converts CRLF/CR to LF. */
export function normalizeSql(raw: string): string {
  return raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** sha256 hex of the normalised SQL. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** `0004_api_requests.sql` → { version: '0004', name: 'api_requests' }; null when it does not match. */
export function parseMigrationFileName(fileName: string): { version: string; name: string } | null {
  const match = MIGRATION_FILE_PATTERN.exec(fileName);
  if (!match?.[1] || !match[2]) return null;
  return { version: match[1], name: match[2] };
}

/** `0004_api_requests` — the label used in logs and in SchemaStatus lists. */
export function migrationLabel(m: { version: string; name: string }): string {
  return `${m.version}_${m.name}`;
}

/** Picks the `.sql` files, rejecting malformed names and duplicate versions; sorted by version. */
export function selectMigrationFileNames(entries: string[]): string[] {
  const sqlFiles = entries.filter((entry) => entry.toLowerCase().endsWith('.sql')).sort();
  const seen = new Map<string, string>();
  for (const fileName of sqlFiles) {
    const parsed = parseMigrationFileName(fileName);
    if (!parsed) {
      throw new MigrationFileError(`migration file "${fileName}" does not match NNNN_snake_case.sql`);
    }
    const previous = seen.get(parsed.version);
    if (previous) {
      throw new MigrationFileError(`migrations "${previous}" and "${fileName}" share version ${parsed.version}`);
    }
    seen.set(parsed.version, fileName);
  }
  return sqlFiles;
}

/** Loads one file: read, normalise, hash. */
export async function loadMigrationFile(dir: string, fileName: string): Promise<MigrationFile> {
  const parsed = parseMigrationFileName(fileName);
  if (!parsed) throw new MigrationFileError(`migration file "${fileName}" does not match NNNN_snake_case.sql`);
  const sql = normalizeSql(await readFile(path.join(dir, fileName), 'utf8'));
  return { ...parsed, fileName, sql, checksum: checksumOf(sql) };
}

/** Loads every migration in `dir`, ordered by version. Non-.sql files (README.md) are ignored. */
export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const fileNames = selectMigrationFileNames(await readdir(dir));
  return Promise.all(fileNames.map((fileName) => loadMigrationFile(dir, fileName)));
}
