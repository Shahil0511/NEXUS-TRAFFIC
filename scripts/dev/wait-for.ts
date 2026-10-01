/**
 * Small waiting/probing primitives: poll until a condition holds, probe an HTTP URL, check whether
 * a TCP port is taken, pick a free port.
 *
 * WHY: every start step ends with "wait until X answers" — one implementation with a timeout and an
 * early-abort hook (a crashed process should stop the wait immediately, not after the timeout).
 */
import net from 'node:net';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  /** Return true to stop waiting early (e.g. the process being waited for has exited). */
  shouldAbort?: () => boolean;
}

/** Polls `check` until it returns true; false on timeout or abort. */
export async function waitUntil(check: () => Promise<boolean>, options: WaitOptions): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs;
  const interval = options.intervalMs ?? 1000;
  while (Date.now() < deadline) {
    if (options.shouldAbort?.()) return false;
    if (await check()) return true;
    await sleep(interval);
  }
  return false;
}

export interface HttpProbe {
  ok: boolean;
  status: number | null;
  /** Short reason when there was no HTTP answer at all (refused, timeout). */
  error?: string;
}

/** GET `url` without following redirects; ok = 2xx. Never throws. */
export async function probeHttp(url: string, timeoutMs: number = 2500): Promise<HttpProbe> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await res.body?.cancel();
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return { ok: false, status: null, error: cause ?? (err as Error).name };
  }
}

function connects(port: number, host: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** True when something accepts TCP connections on the port (IPv4 or IPv6 loopback). */
export async function isPortInUse(port: number, timeoutMs: number = 500): Promise<boolean> {
  const [v4, v6] = await Promise.all([connects(port, '127.0.0.1', timeoutMs), connects(port, '::1', timeoutMs)]);
  return v4 || v6;
}

/** Binds an http-like server to 127.0.0.1, trying `start`, `start+1`, … ; resolves with the bound port. */
export async function listenOnFreePort(
  server: net.Server,
  start: number,
  attempts: number,
): Promise<number> {
  for (let port = start; port < start + attempts; port += 1) {
    if (await isPortInUse(port)) continue;
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve(false);
        else reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(true);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (bound) return port;
  }
  throw new Error(`no free port in ${start}–${start + attempts - 1}`);
}
