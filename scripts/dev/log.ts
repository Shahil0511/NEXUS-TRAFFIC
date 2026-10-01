/**
 * Colored, prefixed console output (`[db] …`, `[api] …`) plus an in-memory ring buffer per source.
 *
 * WHY: five things run at once in one terminal; a fixed-width colored prefix keeps them readable,
 * and the launcher's Logs panel (/logs?proc=api) shows the same lines without a second terminal.
 * NEVER pass a secret to these functions — print masked prefixes only (see maskSecret).
 */

export const LOG_SOURCES = ['dev', 'db', 'build', 'migrate', 'api', 'web', 'launcher'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** Lines kept per source for the launcher's Logs panel. */
export const LOG_RING_SIZE = 200;

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const SOURCE_COLORS: Record<LogSource, string> = {
  dev: ANSI.gray,
  db: ANSI.blue,
  build: ANSI.gray,
  migrate: ANSI.magenta,
  api: ANSI.green,
  web: ANSI.cyan,
  launcher: ANSI.yellow,
};

const PREFIX_WIDTH = Math.max(...LOG_SOURCES.map((s) => s.length)) + 2;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const buffers = new Map<LogSource, string[]>(LOG_SOURCES.map((s) => [s, []]));

export type LogLevel = 'info' | 'warn' | 'error' | 'ok';

/** Removes terminal color codes (child processes color their own output). */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

function paint(color: string, text: string): string {
  return useColor ? `${color}${text}${ANSI.reset}` : text;
}

function remember(source: LogSource, line: string): void {
  const buffer = buffers.get(source);
  if (!buffer) return;
  buffer.push(line);
  if (buffer.length > LOG_RING_SIZE) buffer.splice(0, buffer.length - LOG_RING_SIZE);
}

const LEVEL_COLORS: Record<LogLevel, string | null> = {
  info: null,
  ok: ANSI.green,
  warn: ANSI.yellow,
  error: ANSI.red,
};

/** One line on the console (prefixed) and in the source's ring buffer. */
export function log(source: LogSource, text: string, level: LogLevel = 'info'): void {
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const plain = stripAnsi(rawLine);
    remember(source, plain);
    const prefix = paint(SOURCE_COLORS[source], `[${source}]`.padEnd(PREFIX_WIDTH));
    const levelColor = LEVEL_COLORS[level];
    const body = levelColor ? paint(levelColor, plain) : rawLine;
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${prefix}${body}\n`);
  }
}

export const warn = (source: LogSource, text: string): void => log(source, text, 'warn');
export const fail = (source: LogSource, text: string): void => log(source, text, 'error');
export const ok = (source: LogSource, text: string): void => log(source, text, 'ok');

/** The last `count` lines of a source (oldest first). */
export function tailLog(source: LogSource, count: number = LOG_RING_SIZE): string[] {
  return (buffers.get(source) ?? []).slice(-count);
}

export function isLogSource(value: unknown): value is LogSource {
  return typeof value === 'string' && (LOG_SOURCES as readonly string[]).includes(value);
}

/** `nx_sk_AbCdEfGh…` — enough to recognise a secret, never enough to use it. */
export function maskSecret(secret: string, visible: number = 14): string {
  if (secret.length <= visible) return '…';
  return `${secret.slice(0, visible)}…`;
}

/** A framed block of lines (the end-of-start summary). */
export function printBox(title: string, lines: string[]): void {
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4;
  const horizontal = '─'.repeat(width);
  const out = [
    `┌${horizontal}┐`,
    `│  ${title.padEnd(width - 2)}│`,
    `├${horizontal}┤`,
    ...lines.map((l) => `│  ${l.padEnd(width - 2)}│`),
    `└${horizontal}┘`,
  ];
  process.stdout.write(`\n${paint(ANSI.green, out.join('\n'))}\n\n`);
}
