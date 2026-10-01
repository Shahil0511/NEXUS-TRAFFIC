import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MIGRATIONS_DIR } from '../schema';
import {
  MigrationFileError,
  checksumOf,
  loadMigrations,
  normalizeSql,
  parseMigrationFileName,
  selectMigrationFileNames,
} from './loader';

describe('normalizeSql / checksumOf', () => {
  it('gives LF, CRLF and BOM variants the same checksum', () => {
    const lf = 'CREATE TABLE x (id int);\nSELECT 1;\n';
    const crlfBom = `﻿${lf.replace(/\n/g, '\r\n')}`;
    expect(normalizeSql(crlfBom)).toBe(lf);
    expect(checksumOf(normalizeSql(crlfBom))).toBe(checksumOf(lf));
    expect(checksumOf(lf)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the checksum when the content changes', () => {
    expect(checksumOf('SELECT 1;')).not.toBe(checksumOf('SELECT 2;'));
  });
});

describe('parseMigrationFileName', () => {
  it('splits version and name', () => {
    expect(parseMigrationFileName('0004_api_requests.sql')).toEqual({ version: '0004', name: 'api_requests' });
  });

  it.each(['4_x.sql', '0004-api.sql', '0004_Api.sql', '0004_api.SQL', '0004_.sql', 'README.md'])(
    'rejects %s',
    (name) => {
      expect(parseMigrationFileName(name)).toBeNull();
    },
  );
});

describe('selectMigrationFileNames', () => {
  it('keeps .sql files sorted and ignores other files', () => {
    expect(selectMigrationFileNames(['0002_b.sql', 'README.md', '0001_a.sql'])).toEqual(['0001_a.sql', '0002_b.sql']);
  });

  it('refuses two files with the same version', () => {
    expect(() => selectMigrationFileNames(['0001_a.sql', '0001_b.sql'])).toThrow(MigrationFileError);
  });

  it('refuses a malformed .sql name instead of silently skipping it', () => {
    expect(() => selectMigrationFileNames(['0001_a.sql', '0002_Bad-Name.sql'])).toThrow(MigrationFileError);
  });
});

describe('loadMigrations', () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it('reads, normalises and hashes files in version order', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'nexus-loader-'));
    await writeFile(path.join(dir, '0002_second.sql'), 'SELECT 2;\r\n');
    await writeFile(path.join(dir, '0001_first.sql'), '﻿SELECT 1;\n');
    await writeFile(path.join(dir, 'README.md'), '# docs');
    const files = await loadMigrations(dir);
    expect(files.map((f) => f.fileName)).toEqual(['0001_first.sql', '0002_second.sql']);
    expect(files[0]).toMatchObject({ version: '0001', name: 'first', sql: 'SELECT 1;\n' });
    expect(files[1]?.checksum).toBe(checksumOf('SELECT 2;\n'));
  });

  it('loads the real migrations: contiguous versions, each with an intent comment', async () => {
    const files = await loadMigrations(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(7);
    files.forEach((file, index) => {
      expect(file.version).toBe(String(index + 1).padStart(4, '0'));
      expect(file.sql.startsWith('-- intent:')).toBe(true);
      expect(file.sql).not.toMatch(/^\s*(BEGIN|COMMIT)\s*;/im);
    });
  });
});
