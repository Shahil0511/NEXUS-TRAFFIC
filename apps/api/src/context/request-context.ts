/**
 * Per-request context (request id) carried through async calls without threading parameters.
 * The logger reads it so every log line of a request carries the same `requestId`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
