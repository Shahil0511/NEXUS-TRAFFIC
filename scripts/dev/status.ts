/**
 * Builds the launcher's /status JSON: start steps, dev DB, API, dashboard, demo keys.
 *
 * WHY: the page polls this every 3 s, so checks are cheap (HTTP probes with short timeouts, a
 * cached `docker inspect`) and nothing in the result is secret (key PREFIXES only).
 */
import { KEY_LOOKUP_PREFIX_LENGTH } from '@nexus/shared';

import { devDbState, type ContainerState } from './docker-db';
import { readDevEnvFile } from './env-file';
import type { ProcessInfo, ProcessSupervisor } from './processes';
import type { StepInfo, StepTracker } from './steps';
import { API_PORT, DEV_DB, DEV_URLS, WEB_PORT } from './topology';
import { isPortInUse, probeHttp, type HttpProbe } from './wait-for';

export interface DevStatus {
  generatedAt: string;
  steps: StepInfo[];
  db: { container: string; state: ContainerState; accepting: boolean; port: number };
  api: { port: number; process: ProcessInfo; health: HttpProbe; ready: HttpProbe };
  web: { port: number; process: ProcessInfo; health: HttpProbe };
  demo: { secretKeyPrefix: string | null; publishableKeyPrefix: string | null };
  urls: typeof DEV_URLS;
}

const DB_STATE_CACHE_MS = 2500;

export class StatusCollector {
  private dbStateCache: { at: number; value: ContainerState } | null = null;

  constructor(
    private readonly steps: StepTracker,
    private readonly supervisor: ProcessSupervisor,
    private readonly envFile: string,
  ) {}

  private async cachedDbState(): Promise<ContainerState> {
    const now = Date.now();
    if (this.dbStateCache && now - this.dbStateCache.at < DB_STATE_CACHE_MS) return this.dbStateCache.value;
    const value = await devDbState();
    this.dbStateCache = { at: now, value };
    return value;
  }

  private demoPrefixes(): DevStatus['demo'] {
    const values = readDevEnvFile(this.envFile);
    const prefix = (key: string | undefined) => (key ? key.slice(0, KEY_LOOKUP_PREFIX_LENGTH) : null);
    return {
      secretKeyPrefix: prefix(values?.DEMO_SECRET_KEY),
      publishableKeyPrefix: prefix(values?.DEMO_PUBLISHABLE_KEY),
    };
  }

  async collect(): Promise<DevStatus> {
    const [dbState, accepting, health, ready, webHealth] = await Promise.all([
      this.cachedDbState(),
      isPortInUse(DEV_DB.hostPort),
      probeHttp(DEV_URLS.apiHealth),
      probeHttp(DEV_URLS.apiReady),
      probeHttp(DEV_URLS.webHealth, 4000),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      steps: this.steps.list(),
      db: { container: DEV_DB.container, state: dbState, accepting, port: DEV_DB.hostPort },
      api: { port: API_PORT, process: this.supervisor.info('api'), health, ready },
      web: { port: WEB_PORT, process: this.supervisor.info('web'), health: webHealth },
      demo: this.demoPrefixes(),
      urls: DEV_URLS,
    };
  }
}
