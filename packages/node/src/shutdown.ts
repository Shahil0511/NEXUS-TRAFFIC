import type { NexusClient } from './types';

export interface ShutdownFlushOptions {
  /** How long a flush may delay exit. Default 5 s. */
  deadlineMs?: number;
  /** Signals to hook. Default SIGTERM (what Docker sends) and SIGINT. */
  signals?: readonly NodeJS.Signals[];
}

/**
 * WHY: queued events would be lost when the container stops. This flushes on SIGTERM/SIGINT and
 * on `beforeExit`. If the host app has NO other handler for the signal, the signal is re-raised
 * after the flush so the default exit still happens; if it has one, that handler stays in charge.
 * Returns an unregister function. NEVER throws.
 */
export function registerShutdownFlush(client: NexusClient, options: ShutdownFlushOptions = {}): () => void {
  const { deadlineMs = 5_000, signals = ['SIGTERM', 'SIGINT'] } = options;
  let flushedOnExit = false;

  const onBeforeExit = (): void => {
    if (flushedOnExit) return;
    flushedOnExit = true;
    void client.shutdown(deadlineMs);
  };

  const onSignal = (signal: NodeJS.Signals): void => {
    const othersListen = process.listenerCount(signal) > 1;
    void client.shutdown(deadlineMs).finally(() => {
      if (othersListen) return;
      unregister();
      try {
        process.kill(process.pid, signal);
      } catch {
        // nothing sensible left to do
      }
    });
  };

  function unregister(): void {
    process.removeListener('beforeExit', onBeforeExit);
    for (const signal of signals) process.removeListener(signal, onSignal);
  }

  try {
    process.once('beforeExit', onBeforeExit);
    for (const signal of signals) process.once(signal, onSignal);
  } catch {
    // environments without process signals (edge runtimes) simply get no hook
  }
  return unregister;
}
