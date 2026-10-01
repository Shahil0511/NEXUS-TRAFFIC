/**
 * Opens a URL in the default browser (best effort, never fails the run).
 *
 * WHY: `npm run dev` should end with the launcher in front of you. Windows needs `start` through
 * cmd (the empty "" is the window title, otherwise the URL would be taken as the title).
 */
import { spawn } from 'node:child_process';

import { warn } from './log';

export function openBrowser(url: string): void {
  const [command, args, verbatim] =
    process.platform === 'win32'
      ? (['cmd', ['/c', 'start', '""', url], true] as const)
      : process.platform === 'darwin'
        ? (['open', [url], false] as const)
        : (['xdg-open', [url], false] as const);
  try {
    const child = spawn(command, [...args], {
      stdio: 'ignore',
      detached: process.platform !== 'win32',
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
    });
    child.once('error', () => warn('launcher', `could not open a browser — visit ${url}`));
    child.unref();
  } catch {
    warn('launcher', `could not open a browser — visit ${url}`);
  }
}
