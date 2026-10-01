/**
 * Command-line flags of `npm run dev` (pass them after `--`: `npm run dev -- --no-open --port 3400`).
 *
 * WHY: parsed in one pure function so the flags are documented and testable in one place.
 */
import { DEFAULT_LAUNCHER_PORT } from './topology';

export interface DevArgs {
  /** Do not open the launcher in the browser. */
  open: boolean;
  /** Do not start the Next.js dashboard. */
  web: boolean;
  /** Preferred launcher port (the next free one is used when busy). */
  launcherPort: number;
  /** dev:reset only: skip the confirmation prompt. */
  yes: boolean;
  help: boolean;
}

export const DEV_USAGE = `Usage: npm run dev -- [--no-open] [--no-web] [--port <launcher port>]

  --no-open        do not open the Dev Launcher in the browser
  --no-web         do not start the Next.js dashboard (api + launcher only)
  --port <n>       preferred Dev Launcher port (default ${DEFAULT_LAUNCHER_PORT}; next free port if busy)

Related: npm run dev:stop (stop the dev DB), npm run dev:reset [-- --yes] (delete the dev DB)`;

function parsePort(raw: string | undefined): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`--port needs a number between 1024 and 65535 (got "${raw ?? ''}")`);
  }
  return port;
}

/** Unknown flags throw, so a typo is never silently ignored. */
export function parseDevArgs(argv: readonly string[]): DevArgs {
  const args: DevArgs = { open: true, web: true, launcherPort: DEFAULT_LAUNCHER_PORT, yes: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--no-open') args.open = false;
    else if (arg === '--no-web') args.web = false;
    else if (arg === '--yes' || arg === '-y') args.yes = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--port') args.launcherPort = parsePort(argv[++i]);
    else if (arg.startsWith('--port=')) args.launcherPort = parsePort(arg.slice('--port='.length));
    else throw new Error(`unknown option "${arg}"\n\n${DEV_USAGE}`);
  }
  return args;
}
