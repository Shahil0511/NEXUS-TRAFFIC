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
