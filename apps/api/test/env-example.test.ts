/**
 * `.env.example` contract: every key in the template is read by SOMEONE (the api schema, migrate,
 * compose, or the web container from S2), every required api key is present, and the committed
 * file equals what scripts/generate-env-example.ts renders today.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { apiEnvSchema } from '../src/config/env.schema';
import { APP_ROLE_MODE_VALUES } from '../src/db/migration-runner/bootstrap';

/** The exports of scripts/generate-env-example.ts this test relies on. */
interface EnvExampleScript {
  MIGRATE_KEYS: readonly string[];
  COMPOSE_ONLY_KEYS: readonly string[];
  WEB_KEYS: readonly string[];
  IMAGE_MANAGED_KEYS: readonly string[];
  renderEnvExample: () => string;
  requiredApiKeys: () => string[];
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ENV_EXAMPLE = path.join(REPO_ROOT, '.env.example');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-env-example.ts');

/** Active `KEY=value` lines (commented keys are documentation only). */
function activeKeys(content: string): string[] {
  return content
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

/** `# KEY=value` lines — keys deliberately left to the Docker image. */
function commentedKeys(content: string): string[] {
  return content
    .split('\n')
    .map((line) => /^# ([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

let script: EnvExampleScript;
let content: string;

beforeAll(async () => {
  // Loaded by URL so the api tsconfig (rootDir apps/api) does not pull scripts/ into its program.
  script = (await import(pathToFileURL(SCRIPT).href)) as EnvExampleScript;
  content = fs.readFileSync(ENV_EXAMPLE, 'utf8');
});

describe('.env.example', () => {
  it('is up to date with scripts/generate-env-example.ts (run `npm run env:example`)', () => {
    expect(content).toBe(script.renderEnvExample());
  });

  it('every active key is claimed by the api schema, migrate, compose or the web container', () => {
    const claimed = new Set<string>([
      ...Object.keys(apiEnvSchema.shape),
      ...script.MIGRATE_KEYS,
      ...script.COMPOSE_ONLY_KEYS,
      ...script.WEB_KEYS,
    ]);
    const unclaimed = activeKeys(content).filter((key) => !claimed.has(key));
    expect(unclaimed).toEqual([]);
  });

  it('every REQUIRED api key appears as an active line', () => {
    const active = new Set(activeKeys(content));
    expect(script.requiredApiKeys().length).toBeGreaterThan(0);
    expect(script.requiredApiKeys().filter((key) => !active.has(key))).toEqual([]);
  });

  it('every api key is either active or deliberately left to the Docker image', () => {
    const present = new Set([...activeKeys(content), ...commentedKeys(content)]);
    expect(Object.keys(apiEnvSchema.shape).filter((key) => !present.has(key))).toEqual([]);
    expect(commentedKeys(content).sort()).toEqual([...script.IMAGE_MANAGED_KEYS].sort());
  });

  it('lists the migrate, compose-only and web keys', () => {
    const active = new Set(activeKeys(content));
    for (const key of [...script.MIGRATE_KEYS, ...script.COMPOSE_ONLY_KEYS, ...script.WEB_KEYS]) {
      expect(active.has(key), key).toBe(true);
    }
  });

  it('never contains a key twice', () => {
    const keys = activeKeys(content);
    expect(keys.length).toBe(new Set(keys).size);
  });
});

// ─── ADR 0002: external database, DB_APP_ROLE_MODE, localdb profile ──────────

/** The value of an active `KEY=value` line ('' when absent). */
function valueOf(key: string): string {
  const line = content.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : '';
}

/** The `# …` comment block directly above `KEY=` (the key's description). */
function descriptionOf(key: string): string {
  const lines = content.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`${key}=`));
  const block: string[] = [];
  for (let i = at - 1; i >= 0 && lines[i]!.startsWith('# '); i -= 1) block.unshift(lines[i]!);
  return block.join('\n');
}

describe('.env.example database section (ADR 0002)', () => {
  it('DB_APP_ROLE_MODE is a valid mode and both modes are explained', () => {
    expect(APP_ROLE_MODE_VALUES).toContain(valueOf('DB_APP_ROLE_MODE'));
    const text = descriptionOf('DB_APP_ROLE_MODE');
    expect(text).toMatch(/owner\s+→/);
    expect(text).toMatch(/separate\s+→/);
    expect(text).toContain('DATABASE_URL = MIGRATION_DATABASE_URL');
  });

  it('connection strings are placeholders only — never a real login, password or host', () => {
    for (const key of ['MIGRATION_DATABASE_URL', 'DATABASE_URL', 'BACKUP_DATABASE_URL']) {
      const value = valueOf(key);
      expect(value === '' || value.includes('change-me'), key).toBe(true);
      expect(value, key).not.toContain('10.150.0.5');
    }
    expect(content).toContain('@ → %40'); // the URL-encoding note
  });

  it('NEXUS_APP_DB_PASSWORD is documented as separate-mode only and left empty', () => {
    expect(valueOf('NEXUS_APP_DB_PASSWORD')).toBe('');
    expect(descriptionOf('NEXUS_APP_DB_PASSWORD')).toContain('ONLY for DB_APP_ROLE_MODE=separate');
  });

  it('every POSTGRES_* key is marked as only for --profile localdb', () => {
    for (const key of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
      expect(descriptionOf(key), key).toContain('ONLY for --profile localdb');
    }
  });

  it('defaults the Postgres image to 18 (the production server major)', () => {
    expect(valueOf('PG_IMAGE')).toBe('postgres:18-alpine');
  });
});
