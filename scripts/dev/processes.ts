/**
 * Supervisor of the long-running children (api, web): start, track state, stop the whole tree.
 *
 * WHY: `tsx watch` and `next dev` each spawn grandchildren; killing only the direct child would
 * leave a server holding port 4000/3305. On Windows the tree is killed with `taskkill /T /F`, on
 * POSIX the child leads its own process group and the group is signalled.
 */
import { spawn, type ChildProcess } from 'node:child_process';

import { log, warn, type LogSource } from './log';
import { startCommand, type CommandSpec, type StartOptions } from './run-command';

export type ProcessState = 'not-started' | 'running' | 'exited' | 'stopped' | 'skipped';

export interface ProcessInfo {
  state: ProcessState;
  pid: number | null;
  exitCode: number | null;
  /** Why it was skipped / what happened, shown on the launcher page. */
  note: string | null;
}

interface Entry {
  child: ChildProcess | null;
  info: ProcessInfo;
}

/** Kills a process and all its descendants. Never throws (the process may already be gone). */
export function killProcessTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', () => resolve());
      killer.once('close', () => resolve());
      return;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    resolve();
  });
}

const IDLE: ProcessInfo = { state: 'not-started', pid: null, exitCode: null, note: null };

export class ProcessSupervisor {
  private readonly entries = new Map<LogSource, Entry>();
  private stopping = false;

  /** Starts `spec` under `name`; its output goes to the `name` log. */
  start(name: LogSource, spec: CommandSpec, options: StartOptions = {}): ChildProcess {
    const child = startCommand(name, spec, options);
    const entry: Entry = { child, info: { state: 'running', pid: child.pid ?? null, exitCode: null, note: null } };
    this.entries.set(name, entry);
    child.once('error', (err) => {
      entry.info = { ...entry.info, state: 'exited', note: `could not start: ${err.message}` };
      log(name, `could not start: ${err.message}`, 'error');
    });
    child.once('exit', (code) => {
      const wasStopped = this.stopping || entry.info.state === 'stopped';
      entry.info = { ...entry.info, state: wasStopped ? 'stopped' : 'exited', exitCode: code };
      if (!wasStopped) warn(name, `process exited with code ${code ?? 'null'}`);
    });
    return child;
  }

  /** Records that a process was deliberately not started (shown on the launcher page). */
  skip(name: LogSource, note: string): void {
    this.entries.set(name, { child: null, info: { state: 'skipped', pid: null, exitCode: null, note } });
  }

  note(name: LogSource, note: string): void {
    const entry = this.entries.get(name);
    if (entry) entry.info = { ...entry.info, note };
  }

  info(name: LogSource): ProcessInfo {
    return this.entries.get(name)?.info ?? IDLE;
  }

  isRunning(name: LogSource): boolean {
    return this.info(name).state === 'running';
  }

  /** Stops every running child (whole process trees) and waits for the kills to finish. */
  async stopAll(): Promise<void> {
    this.stopping = true;
    const running = [...this.entries.entries()].filter(([, e]) => e.info.state === 'running' && e.child?.pid);
    await Promise.all(
      running.map(async ([name, entry]) => {
        entry.info = { ...entry.info, state: 'stopped' };
        log(name, 'stopping …');
        await killProcessTree(entry.child?.pid ?? 0);
      }),
    );
  }
}
