/**
 * What the sender must do with an ingest response — guide chapter 4
 * (docs/integration/04-responses-retries.md).
 */
export type IngestOutcome =
  | { action: 'done'; accepted: number; duplicates: number; rejected: number }
  | { action: 'drop'; reason: string }
  | { action: 'pauseAuth'; status: number }
  | { action: 'split' }
  | { action: 'retryAfter'; header: string | null }
  | { action: 'backoff'; reason: string }
  | { action: 'proxy'; status: number };

/** The parts of an HTTP response the classifier needs (body already read as text). */
export interface RawIngestResponse {
  status: number;
  contentType: string;
  retryAfter: string | null;
  body: string;
}

/** Parse a body as JSON; `undefined` when it is not JSON. */
function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * WHY: our API ALWAYS answers ingest with JSON and NEVER redirects. A redirect, HTML or any other
 * non-JSON body on 2xx/4xx means an SSO page or proxy swallowed the call — retrying cannot help.
 */
function looksIntercepted(raw: RawIngestResponse): boolean {
  if (raw.status >= 300 && raw.status < 400) return true;
  if (raw.status >= 500) return false; // a gateway's HTML 502 is a normal transient failure
  if (raw.contentType.toLowerCase().includes('text/html')) return true;
  return raw.body.trim() !== '' && parseJson(raw.body) === undefined;
}

/** Read the counters of a 202 body, tolerating missing fields. */
function countersOf(body: string): { accepted: number; duplicates: number; rejected: number } {
  const value = parseJson(body) as
    | { accepted?: unknown; duplicates?: unknown; rejected?: unknown }
    | null
    | undefined;
  const count = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  return {
    accepted: count(value?.accepted),
    duplicates: count(value?.duplicates),
    rejected: Array.isArray(value?.rejected) ? value.rejected.length : 0,
  };
}

/** WHY: a pure function so every branch of the retry table is unit-testable without HTTP. */
export function classifyResponse(raw: RawIngestResponse): IngestOutcome {
  if (looksIntercepted(raw)) return { action: 'proxy', status: raw.status };
  const { status } = raw;
  if (status >= 200 && status < 300) return { action: 'done', ...countersOf(raw.body) };
  if (status === 401 || status === 403) return { action: 'pauseAuth', status };
  if (status === 413) return { action: 'split' };
  if (status === 429 || status === 503) return { action: 'retryAfter', header: raw.retryAfter };
  if (status >= 500) return { action: 'backoff', reason: `HTTP ${status}` };
  return { action: 'drop', reason: `HTTP ${status}` };
}
