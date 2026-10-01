/**
 * Zero-dependency JSON-lines logger (AgreementVault template).
 *
 * WHY: one line per event, machine-parseable by `docker compose logs`, request id attached from
 * AsyncLocalStorage, PII redacted on the way out. warn/error go to stderr.
 */
import { currentRequestId } from '../context/request-context';
import { redactMeta } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor(
    private readonly minLevel: LogLevel,
    private readonly bindings: Record<string, unknown> = {},
  ) {}

  child(bindings: Record<string, unknown>): Logger {
    return new Logger(this.minLevel, { ...this.bindings, ...bindings });
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    this.write('debug', msg, meta);
  }

  info(msg: string, meta?: Record<string, unknown>): void {
    this.write('info', msg, meta);
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    this.write('warn', msg, meta);
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    this.write('error', msg, meta);
  }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      requestId: currentRequestId(),
      ...this.bindings,
      ...(meta ? (redactMeta(meta) as Record<string, unknown>) : {}),
    });
    if (level === 'warn' || level === 'error') process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  }
}

export function createLogger(level: LogLevel): Logger {
  return new Logger(level, { service: 'nexus-traffic-api' });
}
