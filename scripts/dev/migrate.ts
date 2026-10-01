/**
 * Runs the api's migrations against the dev DB (DB_APP_ROLE_MODE=separate, ADR 0002).
 *
 * WHY: the api refuses to boot when the schema is behind (apps/api/src/server.ts), so migrations
 * run before every start. `separate` mode makes the bootstrap create role `nexus_app` (DML only)
 * with NEXUS_APP_DB_PASSWORD — the same split as the docker rehearsal — and the api connects as it.
 */
import path from 'node:path';

import { migrateEnv, withBaseEnv } from './child-env';
import type { DevEnvValues } from './env-file';
import { runToCompletion, tsxCommand } from './run-command';
import { REPO_ROOT } from './topology';

const MIGRATE_ENTRY = path.join(REPO_ROOT, 'apps', 'api', 'src', 'db', 'migrate.ts');

/** Resolves with the migrate CLI's exit code (0 ok, 1 failed, 2 checksum drift). */
export function runMigrations(values: DevEnvValues): Promise<number> {
  return runToCompletion('migrate', tsxCommand(['--conditions=@nexus/source', MIGRATE_ENTRY]), {
    cwd: REPO_ROOT,
    env: withBaseEnv(migrateEnv(values)),
  });
}
