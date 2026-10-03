/**
 * Emit the OpenAPI 3.1 document of the PUBLIC ingest contract (docs/dist/openapi.json).
 *
 * WHY: other teams (and their tooling) get a machine-readable contract that is GENERATED from the
 * same zod schemas and ROUTES the API validates with — it cannot drift from the server.
 * The committed copy docs/openapi.json lets reviewers see contract changes in a diff;
 * `--check` fails when it is stale (run it in CI / before committing a contract change).
 *
 * Usage (repo root):
 *   npm run openapi:emit               → writes docs/openapi.json + docs/dist/openapi.json
 *   npm run openapi:emit -- --check    → exit 1 if docs/openapi.json differs from the schemas
 *
 * @see ../packages/shared/src/ingest/schemas.ts   the zod source of every component schema
 * @see ../packages/shared/src/routes.ts           the paths
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  apiErrorBodySchema,
  BROWSER_BATCH_EXAMPLE,
  browserIngestBatchSchema,
  buildIngestUrl,
  DEFAULT_NEXUS_URL,
  ERROR_CODES,
  INGEST_CONTRACT_VERSION,
  INGEST_HEADERS,
  INGEST_LIMITS,
  ingestResultSchema,
  ROUTES,
  SERVER_BATCH_EXAMPLE,
  serverIngestBatchSchema,
  verifyResponseSchema,
  type RouteDescriptor,
} from '@nexus/shared';
import { z } from 'zod';

// ─── Types (the subset of OpenAPI 3.1 we emit) ───────────────────────────────

type JsonObject = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: JsonObject;
  servers: Array<{ url: string; description?: string }>;
  tags: Array<{ name: string; description: string }>;
  paths: Record<string, Record<string, JsonObject>>;
  components: {
    schemas: Record<string, JsonObject>;
    securitySchemes: Record<string, JsonObject>;
    responses: Record<string, JsonObject>;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..');
/** The committed copy reviewers diff. */
export const COMMITTED_OPENAPI_PATH = path.join(REPO_ROOT, 'docs', 'openapi.json');
/** The served copy (GET ROUTES.docs.openapi). */
export const DIST_OPENAPI_PATH = path.join(REPO_ROOT, 'docs', 'dist', 'openapi.json');

/** `https://nexus.libas.in/traffic/api` — derived, so it follows DEFAULT_NEXUS_URL. */
const API_SERVER_URL = buildIngestUrl(DEFAULT_NEXUS_URL, { method: 'GET', path: '' });

const SECURITY_SCHEME = 'NexusSecretKey';
const VERIFY_SECURITY_SCHEME = 'NexusAnyKey';
const TAG_INGEST = 'Ingest';
const TAG_DOCS = 'Docs';
const RETRY_AFTER_HEADER = 'Retry-After';

// ─── Schema conversion ──────────────────────────────────────────────────────

/**
 * WHY draft-2020-12: OpenAPI 3.1 schemas ARE JSON Schema 2020-12. `io: 'input'` describes what a
 * sender may send (defaults are optional, `method` accepts any case before upper-casing).
 */
export function toComponentSchema(schema: z.ZodType): JsonObject {
  const json = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io: 'input',
    unrepresentable: 'any',
  }) as JsonObject;
  delete json['$schema'];
  return json;
}

function ref(name: string): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function responseRef(name: string): JsonObject {
  return { $ref: `#/components/responses/${name}` };
}

/** Express `:param` and `*wildcard` → OpenAPI `{param}`. */
export function toOpenApiPath(route: RouteDescriptor): string {
  return route.path.replace(/[:*]([A-Za-z0-9_]+)/g, '{$1}');
}

function errorResponse(description: string, codes: string[], retryAfter = false): JsonObject {
  return {
    description: `${description} Codes: ${codes.join(', ')}.`,
    ...(retryAfter
      ? {
          headers: {
            [RETRY_AFTER_HEADER]: {
              description: 'Seconds to wait before retrying.',
              schema: { type: 'integer', minimum: 0 },
            },
          },
        }
      : {}),
    content: { 'application/json': { schema: ref('ErrorEnvelope') } },
  };
}

// ─── Building blocks ────────────────────────────────────────────────────────

function buildComponentSchemas(): Record<string, JsonObject> {
  return {
    ServerIngestBatch: toComponentSchema(serverIngestBatchSchema),
    BrowserIngestBatch: toComponentSchema(browserIngestBatchSchema),
    IngestResult: toComponentSchema(ingestResultSchema),
    VerifyResponse: toComponentSchema(verifyResponseSchema),
    ErrorEnvelope: toComponentSchema(apiErrorBodySchema),
  };
}

/** Reusable error responses, keyed by HTTP status (the table in 04-responses-retries). */
function buildComponentResponses(): Record<string, JsonObject> {
  const E = ERROR_CODES;
  return {
    BadRequest: errorResponse('Malformed batch — fix the sender, do NOT retry.', [
      E.INVALID_ENVELOPE,
      E.VALIDATION_ERROR,
      E.BAD_REQUEST,
    ]),
    Unauthorized: errorResponse('Missing or unknown key — pause sending for 5 minutes.', [
      E.MISSING_API_KEY,
      E.INVALID_API_KEY,
    ]),
    Forbidden: errorResponse('Key is valid but not allowed here — pause sending for 5 minutes.', [
      E.WRONG_KEY_TYPE,
      E.SECRET_KEY_EXPOSED,
      E.ORIGIN_NOT_ALLOWED,
      E.APP_DISABLED,
      E.BROWSER_INGEST_DISABLED,
    ]),
    PayloadTooLarge: errorResponse('Body over the limit — split the batch in half and resend.', [
      E.PAYLOAD_TOO_LARGE,
    ]),
    UnsupportedMediaType: errorResponse('Wrong Content-Type — fix the sender, do NOT retry.', [
      E.UNSUPPORTED_MEDIA_TYPE,
    ]),
    RateLimited: errorResponse(
      'Too many requests — wait Retry-After seconds, then resend.',
      [E.RATE_LIMITED],
      true,
    ),
    Unavailable: errorResponse(
      'Database busy or restarting — wait Retry-After seconds, then resend the SAME events.',
      [E.INGEST_UNAVAILABLE, E.SERVICE_UNAVAILABLE],
      true,
    ),
  };
}

function ingestResponses(): JsonObject {
  return {
    '202': {
      description:
        'Batch processed and committed. NEVER retry a 202 — per-event problems are listed in ' +
        '`rejected[]` (fix the sender) and `warnings[]` (event stored, a field was dropped/truncated).',
      content: { 'application/json': { schema: ref('IngestResult') } },
    },
    '400': responseRef('BadRequest'),
    '401': responseRef('Unauthorized'),
    '403': responseRef('Forbidden'),
    '413': responseRef('PayloadTooLarge'),
    '415': responseRef('UnsupportedMediaType'),
    '429': responseRef('RateLimited'),
    '503': responseRef('Unavailable'),
  };
}

function serverIngestOperation(): JsonObject {
  return {
    tags: [TAG_INGEST],
    operationId: 'ingestServerEvents',
    summary: 'Send a batch of backend API-call events (secret key).',
    description:
      `Up to ${INGEST_LIMITS.server.maxEvents} events and ${INGEST_LIMITS.server.maxBodyBytes} bytes ` +
      'per request. Synchronous: a 202 means the rows are committed. `eventId` makes resends ' +
      'idempotent (they are counted in `duplicates`).',
    security: [{ [SECURITY_SCHEME]: [] }],
    parameters: [
      {
        name: 'dryRun',
        in: 'query',
        required: false,
        description: 'Set to `1` to validate and enrich without writing anything.',
        schema: { type: 'string', enum: ['1'] },
      },
    ],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: ref('ServerIngestBatch'),
          examples: { twoRequests: { value: SERVER_BATCH_EXAMPLE } },
        },
      },
    },
    responses: ingestResponses(),
  };
}

function browserIngestOperation(): JsonObject {
  const body = {
    schema: ref('BrowserIngestBatch'),
    examples: { journey: { value: BROWSER_BATCH_EXAMPLE } },
  };
  return {
    tags: [TAG_INGEST],
    operationId: 'ingestBrowserEvents',
    summary: 'Send a batch of frontend usage events (publishable key IN THE BODY).',
    description:
      `Up to ${INGEST_LIMITS.browser.maxEvents} events and ${INGEST_LIMITS.browser.maxBodyBytes} bytes. ` +
      'Sent with `navigator.sendBeacon` as `text/plain` (no CORS preflight). The request Origin must ' +
      "be in the app's allowed origins and every `path` must start with the app's base path. " +
      'A SECRET key here is rejected with 403 SECRET_KEY_EXPOSED and flagged for rotation.',
    security: [],
    requestBody: { required: true, content: { 'text/plain': body, 'application/json': body } },
    responses: ingestResponses(),
  };
}

function verifyOperation(): JsonObject {
  const E = ERROR_CODES;
  return {
    tags: [TAG_INGEST],
    operationId: 'verifyKey',
    summary: 'Check a key (either kind) and read the server clock.',
    security: [{ [VERIFY_SECURITY_SCHEME]: [] }],
    responses: {
      '200': {
        description: 'The key is valid and active.',
        content: { 'application/json': { schema: ref('VerifyResponse') } },
      },
      '401': responseRef('Unauthorized'),
      '403': errorResponse('The app is disabled.', [E.APP_DISABLED]),
      '429': responseRef('RateLimited'),
    },
  };
}

function docsOperation(operationId: string, summary: string, contentType: string): JsonObject {
  return {
    tags: [TAG_DOCS],
    operationId,
    summary,
    security: [],
    responses: {
      '200': { description: 'OK', content: { [contentType]: {} } },
      '404': errorResponse('Not found (or docs not built).', [ERROR_CODES.NOT_FOUND]),
    },
  };
}

function buildPaths(): OpenApiDocument['paths'] {
  const filesOperation = docsOperation(
    'getDocsFile',
    'Download a snippet, example or SDK tarball.',
    'text/plain',
  );
  filesOperation['parameters'] = [
    {
      name: 'filePath',
      in: 'path',
      required: true,
      description: 'Path under files/, e.g. `snippets/curl.sh`.',
      schema: { type: 'string' },
    },
  ];
  return {
    [toOpenApiPath(ROUTES.ingest.server)]: { post: serverIngestOperation() },
    [toOpenApiPath(ROUTES.ingest.browser)]: { post: browserIngestOperation() },
    [toOpenApiPath(ROUTES.ingest.verify)]: { get: verifyOperation() },
    [toOpenApiPath(ROUTES.docs.home)]: {
      get: docsOperation('getGuide', 'The integration guide (HTML).', 'text/html'),
    },
    [toOpenApiPath(ROUTES.docs.openapi)]: {
      get: docsOperation('getOpenApi', 'This document.', 'application/json'),
    },
    [toOpenApiPath(ROUTES.docs.files)]: { get: filesOperation },
  };
}

// ─── The document ───────────────────────────────────────────────────────────

/** Build the whole OpenAPI 3.1 document (pure: no I/O). */
export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Data Nexus Traffic — ingest API',
      version: `${INGEST_CONTRACT_VERSION}.0.0`,
      description:
        `Ingest contract v${INGEST_CONTRACT_VERSION}. Additive changes only within v1; a breaking ` +
        'change ships as /v2. Human guide: ' +
        `${DEFAULT_NEXUS_URL}/api${ROUTES.docs.home.path}`,
    },
    servers: [{ url: API_SERVER_URL, description: 'Production (nexus.libas.in)' }],
    tags: [
      { name: TAG_INGEST, description: 'What other teams call from their apps.' },
      { name: TAG_DOCS, description: 'The public guide and downloads.' },
    ],
    paths: buildPaths(),
    components: {
      schemas: buildComponentSchemas(),
      securitySchemes: {
        [SECURITY_SCHEME]: {
          type: 'apiKey',
          in: 'header',
          name: INGEST_HEADERS.key,
          description:
            'Secret key `nx_sk_…`. Server environments ONLY — never in a browser bundle.',
        },
        [VERIFY_SECURITY_SCHEME]: {
          type: 'apiKey',
          in: 'header',
          name: INGEST_HEADERS.key,
          description: 'Either a secret (`nx_sk_…`) or a publishable (`nx_pk_…`) key.',
        },
      },
      responses: buildComponentResponses(),
    },
  };
}

/** Stable serialisation (2-space JSON + trailing LF) so the committed copy diffs cleanly. */
export function serializeOpenApi(doc: OpenApiDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** Write the document to `target`, creating the directory. */
export function writeOpenApi(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

/** `--check`: true when the committed copy equals what the schemas produce now. */
export function isCommittedCopyCurrent(content: string): boolean {
  return (
    fs.existsSync(COMMITTED_OPENAPI_PATH) &&
    fs.readFileSync(COMMITTED_OPENAPI_PATH, 'utf8') === content
  );
}

function main(argv: string[]): void {
  const content = serializeOpenApi(buildOpenApiDocument());
  if (argv.includes('--check')) {
    if (!isCommittedCopyCurrent(content)) {
      console.error(
        'docs/openapi.json is stale — run `npm run openapi:emit` and commit the result.',
      );
      process.exit(1);
    }
    console.log('docs/openapi.json is current.');
    return;
  }
  writeOpenApi(COMMITTED_OPENAPI_PATH, content);
  writeOpenApi(DIST_OPENAPI_PATH, content);
  console.log(
    `wrote ${path.relative(REPO_ROOT, COMMITTED_OPENAPI_PATH)} and ${path.relative(REPO_ROOT, DIST_OPENAPI_PATH)}`,
  );
}

if (typeof require !== 'undefined' && require.main === module) main(process.argv.slice(2));
