/**
 * `npm run dev` — the WHOLE local dev environment with one command.
 *
 *   1. .env.dev        dev-only secrets (created once, reused)            env-file.ts
 *   2. dev DB          Docker container nexus-traffic-devdb on :55434      docker-db.ts
 *   3. builds          shared packages (for Next) + public guide            build.ts
 *   4. migrations      apps/api migrate CLI, DB_APP_ROLE_MODE=separate       migrate.ts
 *   5. api             tsx watch on :4000                                    servers.ts
 *   6. web             next dev on :3305 (skipped if apps/web is not ready)  servers.ts
 *   7. Dev Launcher    status / sign-in / seed / sample traffic on :3399    launcher-server.ts
 *   8. browser         opens the launcher (unless --no-open)                open-browser.ts
 *   9. Ctrl+C          stops api, web and launcher; the dev DB keeps running
 *
 * The launcher starts right after step 1 so its page can show progress while the rest starts.
 * NEVER touches the root .env, the compose stack, the test containers or the production database.
 *
 * @see ../../ai-context/09-local-development.md
 */
import { buildSharedAndDocs } from './build';
import { describeDevDb, devAdminEmails, type DevTopologyInput } from './child-env';
import { DEV_USAGE, parseDevArgs, type DevArgs } from './cli-args';
import {
  assertDockerRunning,
  DockerNotRunningError,
  devVolumeExists,
  ensureDevDb,
  waitForDevDb,
} from './docker-db';
import { ensureDevEnvFile, type DevEnvValues } from './env-file';
import { LauncherServer } from './launcher-server';
import { fail, log, ok, printBox, warn } from './log';
import { runMigrations } from './migrate';
import { openBrowser } from './open-browser';
import { ProcessSupervisor } from './processes';
import { capture } from './run-command';
import { assertApiPortFree, startApi, startWeb, waitForApi, waitForWeb, webUnavailableReason } from './servers';
import { StatusCollector } from './status';
import { StepTracker } from './steps';
import { DEFAULT_LAUNCHER_PORT, DEV_DB, DEV_ENV_FILE, DEV_URLS, LAUNCHER_PORT_ATTEMPTS } from './topology';
import { listenOnFreePort } from './wait-for';

const DB_READY_TIMEOUT_MS = 90_000;

class DevRun {
  private readonly steps = new StepTracker();
  private readonly supervisor = new ProcessSupervisor();
  private launcher: LauncherServer | null = null;
  private stopping = false;
  private webReason: string | null = null;
  private dbStarted = false;
  /** True when dev:stop / dev:reset asked us to stop: they stop the DB, so don't say it keeps running. */
  private dbStopsElsewhere = false;

  constructor(private readonly args: DevArgs) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  /** Stops api, web and launcher (whole process trees) and exits. The dev DB is left running. */
  readonly shutdown = async (code: number, reason: string): Promise<void> => {
    if (this.stopping) return;
    this.stopping = true;
    log('dev', `stopping (${reason}) …`);
    await this.supervisor.stopAll();
    if (this.launcher) {
      this.launcher.server.closeAllConnections();
      await new Promise<void>((resolve) => this.launcher?.server.close(() => resolve()));
      log('launcher', 'stopped');
    }
    if (this.dbStarted && !this.dbStopsElsewhere) log('dev', 'dev DB still running — npm run dev:stop to stop it');
    else if (this.dbStopsElsewhere) log('dev', 'the dev DB is being stopped by npm run dev:stop / dev:reset');
    process.exit(code);
  };

  private installSignalHandlers(): void {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => void this.shutdown(0, signal));
    }
    process.on('uncaughtException', (err) => {
      fail('dev', `unexpected error: ${err.stack ?? err.message}`);
      void this.shutdown(1, 'unexpected error');
    });
  }

  // ─── Steps ─────────────────────────────────────────────────────────────────

  private prepareEnv(): { values: DevEnvValues; created: boolean } {
    this.steps.set('env', 'running');
    const result = ensureDevEnvFile(DEV_ENV_FILE);
    if (result.created) ok('dev', 'created .env.dev with fresh random dev secrets (git-ignored)');
    else if (result.addedKeys.length > 0) ok('dev', `added missing keys to .env.dev: ${result.addedKeys.join(', ')}`);
    else log('dev', 'reusing .env.dev');
    this.steps.set('env', 'ok', result.created ? 'created' : 'reused');
    return { values: result.values, created: result.created };
  }

  private async startLauncher(values: DevEnvValues, adminEmails: string[]): Promise<LauncherServer> {
    const launcher: LauncherServer = new LauncherServer({
      envFile: DEV_ENV_FILE,
      jwtSecret: values.LIBAS_JWT_SECRET,
      adminEmails,
      status: new StatusCollector(this.steps, this.supervisor, DEV_ENV_FILE),
      defaultReturnUrl: (): string => (this.supervisor.isRunning('web') ? DEV_URLS.dashboard : `${launcher.origin}/`),
      onShutdown: ({ dbStopping }) => {
        if (dbStopping) this.dbStopsElsewhere = true;
        void this.shutdown(0, dbStopping ? 'npm run dev:stop / dev:reset' : 'stop requested from the launcher');
      },
    });
    const port = await listenOnFreePort(launcher.server, this.args.launcherPort, LAUNCHER_PORT_ATTEMPTS);
    if (port !== this.args.launcherPort) warn('launcher', `port ${this.args.launcherPort} is busy — using ${port}`);
    ok('launcher', `Dev Launcher listening on ${launcher.origin}/ (127.0.0.1 only)`);
    return launcher;
  }

  private async startDb(values: DevEnvValues, envCreated: boolean): Promise<boolean> {
    this.steps.set('db', 'running');
    if (envCreated && (await devVolumeExists())) {
      warn('db', `volume ${DEV_DB.volume} already exists but .env.dev is new: the old DB password no longer matches.`);
      warn('db', 'If migrations fail with an authentication error, run: npm run dev:reset -- --yes');
    }
    const outcome = await ensureDevDb(values.DEV_DB_PASSWORD);
    this.dbStarted = true;
    log('db', `${DEV_DB.container}: ${outcome}; waiting for Postgres on ${DEV_DB.host}:${DEV_DB.hostPort} …`);
    const ready = await waitForDevDb(DB_READY_TIMEOUT_MS);
    if (!ready) {
      fail('db', `Postgres did not become ready within ${DB_READY_TIMEOUT_MS / 1000}s — check: docker logs ${DEV_DB.container}`);
      this.steps.set('db', 'failed', 'not ready');
      return false;
    }
    ok('db', `ready (${describeDevDb()})`);
    this.steps.set('db', 'ok', outcome);
    return true;
  }

  private async runBuilds(): Promise<void> {
    this.steps.set('build', 'running');
    const { sharedOk, docsOk } = await buildSharedAndDocs();
    const note = [sharedOk ? null : 'shared build failed', docsOk ? null : 'guide build failed'].filter(Boolean).join(', ');
    this.steps.set('build', sharedOk && docsOk ? 'ok' : 'warn', note || null);
  }

  private async migrate(values: DevEnvValues): Promise<boolean> {
    this.steps.set('migrate', 'running');
    const code = await runMigrations(values);
    if (code !== 0) {
      fail('migrate', `migrations failed (exit code ${code}) — see the [migrate] output above`);
      this.steps.set('migrate', 'failed', `exit code ${code}`);
      return false;
    }
    ok('migrate', 'schema is current');
    this.steps.set('migrate', 'ok');
    return true;
  }

  private async api(values: DevEnvValues, topology: DevTopologyInput): Promise<void> {
    this.steps.set('api', 'running');
    startApi(this.supervisor, values, topology);
    if (await waitForApi(this.supervisor)) {
      this.steps.set('api', 'ok');
      return;
    }
    warn('api', 'the API did not become healthy — see the [api] logs; tsx watch restarts it when you save a file');
    this.steps.set('api', 'failed', 'not healthy — see logs');
  }

  private async web(values: DevEnvValues, topology: DevTopologyInput): Promise<void> {
    if (!this.args.web) {
      this.webReason = 'disabled with --no-web';
      this.supervisor.skip('web', this.webReason);
      this.steps.set('web', 'skipped', this.webReason);
      return;
    }
    const reason = await webUnavailableReason();
    if (reason) {
      this.webReason = reason;
      warn('web', `dashboard not available yet: ${reason}`);
      this.supervisor.skip('web', `dashboard not available yet: ${reason}`);
      this.steps.set('web', 'skipped', reason);
      return;
    }
    this.steps.set('web', 'running');
    startWeb(this.supervisor, values, topology);
    if (await waitForWeb(this.supervisor)) {
      this.steps.set('web', 'ok');
      return;
    }
    const info = this.supervisor.info('web');
    this.webReason = info.state === 'exited' ? `dev server exited (code ${info.exitCode ?? '?'})` : 'not healthy yet';
    this.supervisor.note('web', `dashboard not available yet: ${this.webReason}`);
    this.steps.set('web', info.state === 'exited' ? 'failed' : 'warn', this.webReason);
  }

  private printSummary(launcherOrigin: string): void {
    const dashboard = this.webReason ? `not available yet (${this.webReason})` : DEV_URLS.dashboard;
    printBox('Data Nexus Traffic — dev environment is up', [
      `Dev Launcher   ${launcherOrigin}/`,
      `Dashboard      ${dashboard}`,
      `API health     ${DEV_URLS.apiHealth}`,
      `Guide          ${DEV_URLS.guide}`,
      `OpenAPI        ${DEV_URLS.openapi}`,
      `Dev DB         ${describeDevDb()}`,
      '',
      'Ctrl+C stops api, web and launcher (the dev DB keeps running).',
      'npm run dev:stop stops the dev DB; npm run dev:reset deletes it.',
    ]);
  }

  // ─── Orchestration ─────────────────────────────────────────────────────────

  async run(): Promise<void> {
    const { values, created } = this.prepareEnv();
    await assertDockerRunning();
    await assertApiPortFree();

    const adminEmails = devAdminEmails(await gitEmail());
    this.launcher = await this.startLauncher(values, adminEmails);
    this.installSignalHandlers();
    const topology: DevTopologyInput = { launcherOrigin: this.launcher.origin, adminEmails };

    const [dbReady] = await Promise.all([this.startDb(values, created), this.runBuilds()]);
    if (!dbReady) return this.shutdown(1, 'dev DB not ready');
    if (!(await this.migrate(values))) return this.shutdown(1, 'migrations failed');

    await this.api(values, topology);
    await this.web(values, topology);

    this.printSummary(this.launcher.origin);
    if (this.args.open) openBrowser(`${this.launcher.origin}/`);
  }
}

/** The developer's git email (made an admin when it is a company address). */
async function gitEmail(): Promise<string | null> {
  const result = await capture('git', ['config', 'user.email'], { timeoutMs: 5000 });
  return result.code === 0 && result.stdout ? result.stdout : null;
}

async function main(): Promise<void> {
  let args: DevArgs;
  try {
    args = parseDevArgs(process.argv.slice(2));
  } catch (err) {
    fail('dev', (err as Error).message);
    process.exit(1);
  }
  if (args.help) {
    process.stdout.write(`${DEV_USAGE}\n`);
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    fail('dev', 'npm run dev is a local development tool and refuses to run with NODE_ENV=production.');
    process.exit(1);
  }
  if (args.launcherPort !== DEFAULT_LAUNCHER_PORT) log('dev', `launcher port requested: ${args.launcherPort}`);

  const run = new DevRun(args);
  try {
    await run.run();
  } catch (err) {
    if (err instanceof DockerNotRunningError) {
      fail('db', err.message);
    } else {
      fail('dev', err instanceof Error ? err.message : String(err));
    }
    await run.shutdown(1, 'start failed');
  }
}

void main();
