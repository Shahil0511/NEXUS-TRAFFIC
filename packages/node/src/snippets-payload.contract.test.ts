/**
 * Snippet PAYLOAD ↔ contract tests (the URL checks live in ./snippets.contract.test.ts).
 *
 * WHY: docs/snippets/ is the code other teams copy. The Express snippets are RUN here against a
 * capturing fetch and their real POST is validated with the PUBLIC zod contract; the curl batch is
 * parsed and validated; the Python and React snippets are checked statically (constants, field
 * names, tool ids, imported names, the early-install entry and its first-import rule). A contract change in @nexus/shared that a snippet does not
 * follow fails this suite instead of failing in another team's production.
 *
 * Snippets live outside this package's rootDir, so they are loaded at runtime by path (typed by
 * the small interfaces below), never imported statically.
 */
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  ENVIRONMENT_VALUES,
  ERROR_CODE_PATTERN,
  INGEST_HEADERS,
  INGEST_LIMITS,
  ROUTES,
  serverEventSchema,
  serverIngestBatchSchema,
  serverIngestEnvelopeSchema,
  TOOL_ACTION_VALUES,
  TOOL_NAME_PATTERN,
} from '@nexus/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SDK_VERSION } from './version';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SNIPPETS_DIR = path.join(REPO_ROOT, 'docs', 'snippets');
const REACT_SRC = path.join(REPO_ROOT, 'packages', 'react', 'src');
const NEXUS_URL = 'https://nexus.libas.in/traffic';
const SERVER_INGEST_PATH = `/api${ROUTES.ingest.server.path}`;
const SESSION_ID = '7c1d2e3f-4a5b-4c6d-8e7f-001122334455';

const EVENT_KEYS = new Set(Object.keys(serverEventSchema.shape));
const ENVELOPE_KEYS = new Set(Object.keys(serverIngestEnvelopeSchema.shape));

function readSnippet(name: string): string {
  return readFileSync(path.join(SNIPPETS_DIR, name), 'utf8');
}

// ─── The surface of the Express snippets ────────────────────────────────────

interface SnippetClient {
  track(event: unknown): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

type SnippetMiddleware = (req: FakeRequest, res: FakeResponse, next: () => void) => void;

interface ExpressSnippet {
  createNexusClient(options: {
    url?: string;
    key?: string;
    environment?: string;
    logger?: { warn: (m: string) => void };
  }): SnippetClient;
  nexusMiddleware(options: {
    client: SnippetClient;
    basePath?: string;
    trustProxyHops: number;
    getUser?: (req: FakeRequest) => string | undefined;
  }): SnippetMiddleware;
}

/** Just the parts of an Express request the snippets read. */
interface FakeRequest {
  method: string;
  originalUrl: string;
  baseUrl: string;
  route?: { path: string };
  headers: Record<string, string | undefined>;
  socket: { remoteAddress: string };
  get(name: string): string | undefined;
}

/** Just the parts of an Express response the snippets read. */
class FakeResponse extends EventEmitter {
  statusCode = 200;
  writableFinished = false;
  locals: Record<string, unknown> = {};
  private readonly responseHeaders: Record<string, string> = {};

  getHeader(name: string): string | undefined {
    return this.responseHeaders[name.toLowerCase()];
  }

  setHeader(name: string, value: string): void {
    this.responseHeaders[name.toLowerCase()] = value;
  }

  finish(): void {
    this.writableFinished = true;
    this.emit('finish');
  }
}

function fakeRequest(overrides: Partial<FakeRequest> = {}): FakeRequest {
  const headers: Record<string, string | undefined> = {
    'x-forwarded-for': '203.0.113.24',
    'user-agent': 'Mozilla/5.0 (contract test)',
    'x-request-id': 'req-123',
    'content-length': '42',
    'x-nexus-session': SESSION_ID,
    ...(overrides.headers ?? {}),
  };
  return {
    method: 'POST',
    originalUrl: '/api/stores/1042?draft=1',
    baseUrl: '/api',
    route: { path: '/stores/:id' },
    socket: { remoteAddress: '10.0.0.5' },
    ...overrides,
    headers,
    get: (name: string) => headers[name.toLowerCase()],
  };
}

interface CapturedPost {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Stub the global fetch the snippets use; every POST is captured and answered 202. */
function captureFetch(): CapturedPost[] {
  const posts: CapturedPost[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      posts.push({
        url,
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string) as unknown,
      });
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [], warnings: [] }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return posts;
}

/** One request through the snippet middleware → the POST it sends on shutdown. */
async function runRequest(
  snippet: ExpressSnippet,
  req: FakeRequest,
  prepare?: (res: FakeResponse) => void,
  clientOptions: { environment?: string; logger?: { warn: (m: string) => void } } = {},
) {
  const posts = captureFetch();
  const client = snippet.createNexusClient({
    url: NEXUS_URL,
    key: 'nx_sk_contract',
    logger: { warn: () => undefined },
    ...clientOptions,
  });
  const middleware = snippet.nexusMiddleware({
    client,
    basePath: '/my-app',
    trustProxyHops: 1,
    getUser: () => 'someone@libas.in',
  });
  const res = new FakeResponse();
  prepare?.(res);
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  res.finish();
  await client.shutdown();
  return { posts, nextCalled };
}

async function loadExpressSnippets(): Promise<Array<[string, ExpressSnippet]>> {
  const cjs = createRequire(__filename)(path.join(SNIPPETS_DIR, 'express-cjs.js')) as ExpressSnippet;
  const esm = (await import(pathToFileURL(path.join(SNIPPETS_DIR, 'express-esm.ts')).href)) as ExpressSnippet;
  return [
    ['express-cjs.js', cjs],
    ['express-esm.ts', esm],
  ];
}

beforeEach(() => {
  vi.stubEnv('NEXUS_ENVIRONMENT', ''); // hermetic: the developer's shell must not change envelopes
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Express snippets send batches that validate against the public contract', () => {
  it('a full request (user, template, session header, error code) → one valid batch', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const { posts, nextCalled } = await runRequest(snippet, fakeRequest(), (res) => {
        res.statusCode = 422;
        res.locals['errorCode'] = 'VALIDATION_ERROR';
        res.setHeader('content-length', '2048');
      });

      expect(nextCalled, name).toBe(true);
      expect(posts, name).toHaveLength(1);
      const [post] = posts;
      expect(post!.url, name).toBe(`${NEXUS_URL}${SERVER_INGEST_PATH}`);
      expect(Object.keys(post!.headers), name).toContain(INGEST_HEADERS.key);
      expect(post!.headers[INGEST_HEADERS.key], name).toBe('nx_sk_contract');

      const parsed = serverIngestBatchSchema.safeParse(post!.body);
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      const batch = parsed.data!;
      const event = batch.events[0]!;
      expect(event, name).toMatchObject({
        method: 'POST',
        path: '/my-app/api/stores/1042',
        routeTemplate: '/my-app/api/stores/:id',
        status: 422,
        ip: '203.0.113.24',
        userEmail: 'someone@libas.in',
        errorCode: 'VALIDATION_ERROR',
        sessionId: SESSION_ID,
        requestId: 'req-123',
      });
      expect(batch.sdk?.name.length, name).toBeLessThanOrEqual(INGEST_LIMITS.maxSdkNameLength);
      expect(batch.sdk?.version.length, name).toBeLessThanOrEqual(INGEST_LIMITS.maxSdkVersionLength);
    }
  });

  it('every field a snippet sends is a field of the contract (nothing silently stripped)', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const { posts } = await runRequest(snippet, fakeRequest());
      const body = posts[0]!.body as Record<string, unknown>;
      expect(Object.keys(body).filter((key) => !ENVELOPE_KEYS.has(key)), name).toEqual([]);
      const event = (body['events'] as Array<Record<string, unknown>>)[0]!;
      expect(Object.keys(event).filter((key) => !EVENT_KEYS.has(key)), name).toEqual([]);
    }
  });

  it('a minimal request (no template, no user, no headers) is still valid', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const req = fakeRequest({ method: 'GET', originalUrl: '/', baseUrl: '' });
      delete req.route;
      for (const header of Object.keys(req.headers)) req.headers[header] = undefined;
      const { posts } = await runRequest(snippet, req);
      const parsed = serverIngestBatchSchema.safeParse(posts[0]!.body);
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });

  it.each(ENVIRONMENT_VALUES)('environment %s (option) is sent in a valid envelope', async (environment) => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const { posts } = await runRequest(snippet, fakeRequest(), undefined, { environment });
      const parsed = serverIngestBatchSchema.safeParse(posts[0]!.body);
      expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      expect(parsed.data?.environment, name).toBe(environment);
    }
  });

  it('environment falls back to NEXUS_ENVIRONMENT; unset → no environment key', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const unset = await runRequest(snippet, fakeRequest());
      expect(Object.keys(unset.posts[0]!.body as object), name).not.toContain('environment');
      vi.stubEnv('NEXUS_ENVIRONMENT', 'staging');
      const fromEnv = await runRequest(snippet, fakeRequest());
      expect((fromEnv.posts[0]!.body as { environment?: string }).environment, name).toBe('staging');
      vi.stubEnv('NEXUS_ENVIRONMENT', '');
    }
  });

  it('an invalid environment is NOT sent (one warning) and the batch stays valid', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const warnings: string[] = [];
      const { posts } = await runRequest(snippet, fakeRequest(), undefined, {
        environment: 'production',
        logger: { warn: (m) => warnings.push(m) },
      });
      expect(Object.keys(posts[0]!.body as object), name).not.toContain('environment');
      expect(serverIngestBatchSchema.safeParse(posts[0]!.body).success, name).toBe(true);
      expect(warnings.filter((m) => m.includes('environment')), name).toHaveLength(1);
    }
  });

  it('health checks are skipped (nothing is sent)', async () => {
    for (const [name, snippet] of await loadExpressSnippets()) {
      const { posts } = await runRequest(snippet, fakeRequest({ method: 'GET', originalUrl: '/health' }));
      expect(posts, name).toEqual([]);
    }
  });
});

// ─── Static contract constants of every server snippet ──────────────────────

/** `NAME = 123` / `const NAME = 3_600_000;` → the number. */
function numericConstant(source: string, name: string): number | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)\\b`).exec(source);
  return match ? Number(match[1]!.replace(/_/g, '')) : undefined;
}

/** `NAME = 'text'` / `NAME = "text"` → text. */
function stringConstant(source: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(source)?.[1];
}

/** `LIMITS = { path: 2048, … }` → { path: 2048, … }. */
function limitsObject(source: string): Record<string, number> {
  const body = /\bLIMITS\s*=\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  return Object.fromEntries(
    [...body.matchAll(/(\w+):\s*([0-9_]+)/g)].map((m) => [m[1]!, Number(m[2]!.replace(/_/g, ''))]),
  );
}

describe.each(['express-cjs.js', 'express-esm.ts'])('%s contract constants', (name) => {
  const source = readSnippet(name);

  it('ingest path, key header and batch size come from the contract', () => {
    expect(stringConstant(source, 'SERVER_INGEST_PATH')).toBe(SERVER_INGEST_PATH);
    expect(stringConstant(source, 'KEY_HEADER')).toBe(INGEST_HEADERS.key);
    expect(numericConstant(source, 'MAX_EVENTS_PER_REQUEST')).toBe(INGEST_LIMITS.server.maxEvents);
    expect(numericConstant(source, 'MAX_DURATION_MS')).toBe(INGEST_LIMITS.maxDurationMs);
  });

  it('field limits equal INGEST_LIMITS', () => {
    const limits = limitsObject(source);
    expect(limits['path']).toBe(INGEST_LIMITS.maxWirePathLength);
    expect(limits['routeTemplate']).toBe(INGEST_LIMITS.maxRouteTemplateLength);
    expect(limits['email']).toBe(INGEST_LIMITS.maxEmailLength);
    expect(limits['userAgent']).toBe(INGEST_LIMITS.maxUserAgentWireLength);
    expect(limits['requestId']).toBe(INGEST_LIMITS.maxRequestIdLength);
  });

  it('the error-code pattern equals ERROR_CODE_PATTERN', () => {
    expect(source).toContain(`ERROR_CODE_PATTERN = ${ERROR_CODE_PATTERN.toString()}`);
  });

  it('ENVIRONMENT_VALUES equal the shared enum and the sdk version equals SDK_VERSION', () => {
    expect(source).toContain(`ENVIRONMENT_VALUES = [${ENVIRONMENT_VALUES.map((v) => `'${v}'`).join(', ')}]`);
    expect(stringConstant(source, 'sdkVersion')).toBe(SDK_VERSION);
  });

  it('the header comment says LOUDLY that getUser defaults to anonymous', () => {
    expect(source).toContain('getUser DEFAULTS TO ANONYMOUS');
    expect(source).toContain('NEXUS_ENVIRONMENT');
  });
});

describe('fastapi_nexus_asgi.py contract', () => {
  const source = readSnippet('fastapi_nexus_asgi.py');

  it('ingest path, key header and limits equal the contract', () => {
    expect(stringConstant(source, 'SERVER_INGEST_PATH')).toBe(SERVER_INGEST_PATH);
    expect(stringConstant(source, 'KEY_HEADER')).toBe(INGEST_HEADERS.key);
    expect(numericConstant(source, 'MAX_EVENTS_PER_REQUEST')).toBe(INGEST_LIMITS.server.maxEvents);
    expect(numericConstant(source, 'MAX_PATH')).toBe(INGEST_LIMITS.maxWirePathLength);
    expect(numericConstant(source, 'MAX_ROUTE_TEMPLATE')).toBe(INGEST_LIMITS.maxRouteTemplateLength);
    expect(numericConstant(source, 'MAX_EMAIL')).toBe(INGEST_LIMITS.maxEmailLength);
    expect(numericConstant(source, 'MAX_USER_AGENT')).toBe(INGEST_LIMITS.maxUserAgentWireLength);
    expect(numericConstant(source, 'MAX_REQUEST_ID')).toBe(INGEST_LIMITS.maxRequestIdLength);
    expect(numericConstant(source, 'MAX_DURATION_MS')).toBe(INGEST_LIMITS.maxDurationMs);
    expect(source).toContain(`re.compile(r"${ERROR_CODE_PATTERN.source}")`);
  });

  it('every key of the event dict is a contract field, and every required field is sent', () => {
    const literal = /event: dict\[str, Any\] = \{([\s\S]*?)\n {8}\}/.exec(source)?.[1];
    expect(literal, 'event dict literal of _build not found').toBeDefined();
    const keys = [...literal!.matchAll(/^\s*"([A-Za-z]+)":/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    expect(keys.filter((key) => !EVENT_KEYS.has(key))).toEqual([]);
    const required = Object.entries(serverEventSchema.shape)
      .filter(([, schema]) => !schema.safeParse(undefined).success)
      .map(([key]) => key);
    expect(required.filter((key) => !keys.includes(key))).toEqual([]);
  });

  it('the batch body uses exactly the envelope fields (environment included) and strips None', () => {
    const body = /body = \{([^}]*)\}/.exec(source)?.[1] ?? '';
    const keys = [...body.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]!);
    expect(keys).toContain('environment');
    expect(keys.sort()).toEqual([...ENVELOPE_KEYS].sort());
    expect(source).toContain('body = {k: v for k, v in body.items() if v is not None}');
  });

  it('NexusClient(url, key, *, environment=None, …) defaults to NEXUS_ENVIRONMENT and reports SDK_VERSION', () => {
    const init = /class NexusClient:[\s\S]*?def __init__\(([\s\S]*?)\) -> None:/.exec(source)?.[1] ?? '';
    const params = init.split(',').map((p) => p.trim()).filter(Boolean);
    expect(params.slice(0, 4)).toEqual(['self', 'url: Optional[str]', 'key: Optional[str]', '*']);
    expect(params).toContain('environment: Optional[str] = None');
    expect(params).toContain(`sdk_version: str = "${SDK_VERSION}"`);
    expect(source).toContain('os.getenv("NEXUS_ENVIRONMENT")');
    expect(source).toContain(`ENVIRONMENT_VALUES = (${ENVIRONMENT_VALUES.map((v) => `"${v}"`).join(', ')})`);
  });

  it('the header docstring says LOUDLY that get_user defaults to anonymous', () => {
    expect(source).toContain('get_user DEFAULTS TO ANONYMOUS');
  });
});

// ─── curl.sh ────────────────────────────────────────────────────────────────

describe('curl.sh contract', () => {
  const source = readSnippet('curl.sh');

  it('its batch() heredoc is a valid server batch', () => {
    const heredoc = /cat <<JSON\n([\s\S]*?)\nJSON/.exec(source)?.[1];
    expect(heredoc, 'batch() heredoc not found').toBeDefined();
    const now = new Date().toISOString();
    const json = heredoc!
      .replace(/\$\(now\)/g, now)
      .replace(/\$\{EVENT_ID\}/g, '0f8fad5b-d9cb-469f-a165-70867728950e')
      .replace(/\$\{OCCURRED_AT\}/g, now);
    expect(json).not.toMatch(/\$[({]/);
    const parsed = serverIngestBatchSchema.safeParse(JSON.parse(json));
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('its batch sends a valid environment', () => {
    const environment = /"environment":\s*"([^"]+)"/.exec(source)?.[1];
    expect(ENVIRONMENT_VALUES as readonly string[]).toContain(environment);
  });

  it('every request sends the key in the contract header', () => {
    const headers = [...source.matchAll(/-H "([^:]+): \$\{NEXUS_SECRET_KEY\}"/g)].map((m) => m[1]);
    expect(headers.length).toBeGreaterThan(0);
    expect(new Set(headers)).toEqual(new Set([INGEST_HEADERS.key]));
  });

  it('every API path it calls is a ROUTES.ingest path', () => {
    const ingestPaths = new Set<string>(Object.values(ROUTES.ingest).map((route) => route.path));
    const called = [...source.matchAll(/\$\{API\}(\/v1\/[a-z/]+)/g)].map((m) => m[1]!);
    expect(called.length).toBeGreaterThan(0);
    expect(called.filter((p) => !ingestPaths.has(p))).toEqual([]);
  });
});

// ─── NestJS and React snippets ──────────────────────────────────────────────

/** Names in `import { a, b as c, type D } from '<from>'`. */
function importedNames(source: string, from: string): string[] {
  const escaped = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const match = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${escaped}'`).exec(source);
  return (match?.[1] ?? '')
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!)
    .filter(Boolean);
}

/** Exported value/type names of a module source (export function/const/interface + export { … }). */
function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const m of source.matchAll(/export\s+(?:async\s+)?(?:function|const|interface|type|class)\s+(\w+)/g)) {
    names.add(m[1]!);
  }
  for (const m of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('nestjs.main.ts', () => {
  it('imports only what express-esm.ts (saved as ./nexus) exports', () => {
    const names = importedNames(readSnippet('nestjs.main.ts'), './nexus');
    expect(names).toEqual(expect.arrayContaining(['createNexusClient', 'nexusMiddleware']));
    const exported = exportedNames(readSnippet('express-esm.ts'));
    expect(names.filter((name) => !exported.has(name))).toEqual([]);
  });
});

describe.each([
  ['next-tracker.tsx', '@nexus/react/next', 'next.tsx'],
  ['vite-react-tracker.tsx', '@nexus/react', 'index.ts'],
])('%s', (name, entry, entryFile) => {
  const source = readSnippet(name);

  it(`imports only names ${entry} exports`, () => {
    const names = importedNames(source, entry);
    expect(names.length).toBeGreaterThan(0);
    const exported = exportedNames(readFileSync(path.join(REACT_SRC, entryFile), 'utf8'));
    expect(names.filter((n) => !exported.has(n))).toEqual([]);
  });

  it('tool ids match TOOL_NAME_PATTERN and actions are TOOL_ACTION_VALUES', () => {
    const tools = [
      ...[...source.matchAll(/data-nexus-tool="([^"]+)"/g)].map((m) => m[1]!),
      ...[...source.matchAll(/trackTool\('([^']+)'/g)].map((m) => m[1]!),
    ];
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.filter((tool) => !TOOL_NAME_PATTERN.test(tool))).toEqual([]);

    const actions = [
      ...[...source.matchAll(/data-nexus-action="([^"]+)"/g)].map((m) => m[1]!),
      ...[...source.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]!),
    ];
    const allowed = new Set<string>(TOOL_ACTION_VALUES);
    expect(actions.filter((action) => !allowed.has(action))).toEqual([]);
  });

  it('labels stay within the contract limit', () => {
    const labels = [...source.matchAll(/data-nexus-label="([^"]+)"/g)].map((m) => m[1]!);
    for (const label of labels) expect(label.length).toBeLessThanOrEqual(INGEST_LIMITS.maxLabelLength);
  });
});

// ─── Early install (ADR 0011): NOT rows of the table above — they have no tools ─

const EARLY_ENTRY = '@nexus/react/early';

/**
 * The early snippets import ONLY names @nexus/react/early (src/early.ts) exports, installNexusEarly
 * among them. Files are read inside the test, so a missing file fails only these tests.
 */
function expectEarlyImport(snippetName: string): void {
  const source = readSnippet(snippetName);
  const names = importedNames(source, EARLY_ENTRY);
  expect(names.length).toBeGreaterThan(0);
  expect(names).toContain('installNexusEarly');
  const exported = exportedNames(readFileSync(path.join(REACT_SRC, 'early.ts'), 'utf8'));
  expect(names.filter((n) => !exported.has(n))).toEqual([]);
  // WHY: without a key scope the kill switch could never turn the early patch off.
  expect(source).toMatch(/installNexusEarly\(\{[\s\S]*\bpublishableKey\b/); // `publishableKey: …` or shorthand
}

describe('next-instrumentation-client.ts', () => {
  it(`imports only names ${EARLY_ENTRY} exports, and passes a publishableKey`, () => {
    expectEarlyImport('next-instrumentation-client.ts');
  });
});

describe('vite-nexus-early.ts', () => {
  it(`imports only names ${EARLY_ENTRY} exports, and passes a publishableKey`, () => {
    expectEarlyImport('vite-nexus-early.ts');
  });
});

describe('vite-react-tracker.tsx early install', () => {
  it("shows main.tsx with `import './nexus-early';` (ESM hoisting: it must be the FIRST import)", () => {
    expect(readSnippet('vite-react-tracker.tsx')).toContain("import './nexus-early';");
  });
});
