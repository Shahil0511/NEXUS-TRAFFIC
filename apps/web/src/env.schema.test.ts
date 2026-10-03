// @vitest-environment node
/**
 * The web env schema ↔ the two places that feed it: `.env.example` (what the TL fills in) and
 * the `web.environment` allowlist in docker-compose.yml (what the container actually receives).
 *
 * WHY: a key added to webEnvSchema but missing from either file only fails at container start
 * (or silently falls back to a default). This catches it in `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { webEnvSchema } from './env.schema';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Read by next.config.ts under `next dev` only; the container never needs it. */
const DEV_ONLY_KEYS = new Set(['API_INTERNAL_URL', 'DEV_USER_EMAIL']);

/** `next dev` sign-in only (apps/web/.env.local via npm run dev:setup): never in the server .env. */
const LOCAL_DEV_FILE_KEYS = new Set(['DEV_USER_EMAIL']);

const WEB_KEYS = Object.keys(webEnvSchema.shape);

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Keys of the `environment:` map of the compose `web` service. */
function composeWebEnvironmentKeys(compose: string): string[] {
  const service = compose.split(/\n {2}web:\n/)[1] ?? '';
  const block = service.split(/\n {4}environment:[^\n]*\n/)[1] ?? '';
  const keys: string[] = [];
  for (const line of block.split('\n')) {
    const match = /^ {6}([A-Z0-9_]+):/.exec(line);
    if (!match) break;
    keys.push(match[1] as string);
  }
  return keys;
}

describe('web env keys', () => {
  it('are all documented in .env.example', () => {
    const example = readRepoFile('.env.example');
    const documented = new Set([...example.matchAll(/^#?\s*([A-Z0-9_]+)=/gm)].map((m) => m[1]));
    expect(WEB_KEYS.filter((key) => !LOCAL_DEV_FILE_KEYS.has(key) && !documented.has(key))).toEqual([]);
  });

  it('are all passed to the web container by docker-compose.yml (except dev-only keys)', () => {
    const passed = new Set(composeWebEnvironmentKeys(readRepoFile('docker-compose.yml')));
    expect(passed.size).toBeGreaterThan(0);
    const missing = WEB_KEYS.filter((key) => !DEV_ONLY_KEYS.has(key) && !passed.has(key));
    expect(missing).toEqual([]);
  });
});
