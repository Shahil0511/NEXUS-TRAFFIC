/**
 * Test-only Logger that records calls instead of writing JSON lines to stdout/stderr.
 */
import type { Logger } from '../../src/lib/logger';

export interface LogCall {
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: Record<string, unknown>;
}

/** WHY: tests assert WHAT was logged (and that secrets were not) without noisy output. */
export function recordingLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const at =
    (level: LogCall['level']) =>
    (msg: string, meta?: Record<string, unknown>): void => {
      calls.push({ level, msg, meta });
    };
  const logger = {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: () => logger,
  } as unknown as Logger;
  return { logger, calls };
}
