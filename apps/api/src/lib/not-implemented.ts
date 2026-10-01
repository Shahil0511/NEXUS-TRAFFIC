/**
 * TEMPORARY scaffolding marker used while a step is being built. The `no-scaffolding` test fails if
 * any source file still calls it — it must never reach main.
 */
export function notImplemented(what: string): Error {
  return new Error(`not implemented: ${what}`);
}
