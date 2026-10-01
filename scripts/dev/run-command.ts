/**
 * Spawning helpers: how to start npm / tsx without a shell, run a command to completion while
 * streaming its output to the prefixed log, and capture a command's output (docker, git).
 *
 * WHY NO SHELL: Node 24 refuses to spawn `.cmd` files without `shell: true` on Windows, and a shell
 * adds quoting problems plus an extra process layer. Running `node <npm-cli.js>` / `node <tsx cli>`
 * directly is portable and keeps the process tree simple to kill.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { log, type LogSource } from './log';
import { REPO_ROOT } from './topology';

export interface CommandSpec {
  command: string;
  args: string[];
  /** Only for the last-resort `npm` fallback (no npm-cli.js found). */
  shell?: boolean;
}

/** npm's JS entry: the one running us (`npm run dev`), else the one bundled next to node. */
function findNpmCli(): string | null {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (candidate && /npm-cli\.js$/.test(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** `npm <args>` without a shell when possible. */
export function npmCommand(args: string[]): CommandSpec {
  const cli = findNpmCli();
  if (cli) return { command: process.execPath, args: [cli, ...args] };
  return { command: 'npm', args, shell: process.platform === 'win32' };
}

/** `tsx <args>` using the repo's own tsx (no new dependency). */
export function tsxCommand(args: string[]): CommandSpec {
  return { command: process.execPath, args: [require.resolve('tsx/cli', { paths: [REPO_ROOT] }), ...args] };
}

/** Calls `onLine` for every complete line of a stream (the last partial line is flushed on end). */
export function forEachLine(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return;
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) onLine(line);
  });
  stream.on('end', () => {
    if (pending) onLine(pending);
    pending = '';
  });
}

export interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** Starts a command with piped output streamed into `source`'s log. */
export function startCommand(source: LogSource, spec: CommandSpec, options: StartOptions = {}): ChildProcess {
  const spawnOptions: SpawnOptions = {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: spec.shell ?? false,
    windowsHide: true,
    // POSIX: own process group so the whole tree can be signalled (Windows uses taskkill /T).
    detached: process.platform !== 'win32',
  };
  const child = spawn(spec.command, spec.args, spawnOptions);
  forEachLine(child.stdout, (line) => log(source, line));
  forEachLine(child.stderr, (line) => log(source, line));
  return child;
}

/** Runs a command to completion, streaming its output; resolves with the exit code (-1 = spawn error). */
export function runToCompletion(source: LogSource, spec: CommandSpec, options: StartOptions = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = startCommand(source, spec, options);
    child.once('error', (err) => {
      log(source, `could not start ${path.basename(spec.command)}: ${err.message}`, 'error');
      resolve(-1);
    });
    child.once('close', (code) => resolve(code ?? -1));
  });
}

export interface CapturedOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a short command (docker, git) and captures its output. ENOENT → code -1. */
export function capture(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CapturedOutput> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeoutMs ?? 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.once('error', (err) => resolve({ code: -1, stdout, stderr: stderr || err.message }));
    child.once('close', (code) => resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
