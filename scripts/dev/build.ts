/**
 * One-off builds before the servers start.
 *
 * WHY: `next dev` resolves @nexus/shared / @nexus/auth from their `dist` (the api and the launcher
 * use the `@nexus/source` condition and do not need it), and the api serves the public guide from
 * docs/dist. Both are best effort: a failure is reported and the run continues, because the api
 * works without them and the dashboard may simply show a build error you can fix live.
 */
import { warn, ok } from './log';
import { npmCommand, runToCompletion } from './run-command';

export interface BuildOutcome {
  sharedOk: boolean;
  docsOk: boolean;
}

export async function buildSharedAndDocs(): Promise<BuildOutcome> {
  const sharedOk = (await runToCompletion('build', npmCommand(['run', 'build:shared']))) === 0;
  if (sharedOk) ok('build', 'shared packages built (packages/shared, packages/auth → dist)');
  else warn('build', 'npm run build:shared failed — the dashboard may not compile until it is fixed');

  const docsOk = (await runToCompletion('build', npmCommand(['run', 'docs:build']))) === 0;
  if (docsOk) ok('build', 'public guide built (docs/dist)');
  else warn('build', 'npm run docs:build failed — continuing; the guide link will 404 until it builds');

  return { sharedOk, docsOk };
}
