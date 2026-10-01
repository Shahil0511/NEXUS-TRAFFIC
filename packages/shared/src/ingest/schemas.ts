/**
 * The PUBLIC ingest contract v1, as zod schemas.
 *
 * WHY THIS FILE EXISTS
 * Other teams implement exactly these shapes (published as docs/dist/openapi.json and
 * docs/integration/02-server-contract.md / 03-browser-contract.md). The API validates with them,
 * the DB CHECK constraints mirror their limits, and the examples in ./examples.ts must satisfy them.
 *
 * TWO LEVELS OF VALIDATION
 * - `*EnvelopeSchema` validates the batch wrapper with `events: unknown[]`, so ONE bad event never
 *   fails the whole batch: the service validates each event separately and lists failures in the
 *   202 body's `rejected[]`.
 * - `*BatchSchema` is the fully-typed shape (docs, OpenAPI, SDK types).
 *
 * Unknown fields are stripped (zod default), so newer SDKs keep working against this server.
 */
import { z } from 'zod';

import {
  ERROR_CODE_PATTERN,
  INGEST_LIMITS,
  PROP_KEY_PATTERN,
  TOOL_NAME_PATTERN,
} from '../constants/ingest';
import { KEY_KIND_VALUES } from '../constants/keys';
import {
  HTTP_METHOD_VALUES,
  NAV_TYPE_VALUES,
  PAGE_TIME_REASON_VALUES,
  SERVER_EVENT_KIND_VALUES,
  TOOL_ACTION_VALUES,
} from '../constants/traffic';
import { INGEST_EVENT_REJECT_CODES, INGEST_WARNING_CODES } from '../errors';

// ─── Shared field schemas ───────────────────────────────────────────────────

/** ISO-8601 with an offset or Z, e.g. 2026-10-01T09:30:04.870+05:30. */
const isoDateTime = z.iso.datetime({ offset: true });

/** Absolute path, basePath included. Query/fragment are stripped server-side. */
const wirePath = z.string().min(1).max(INGEST_LIMITS.maxWirePathLength).startsWith('/');

const routeTemplate = z.string().min(1).max(INGEST_LIMITS.maxRouteTemplateLength).startsWith('/');

const sdkInfo = z.object({
  name: z.string().min(1).max(INGEST_LIMITS.maxSdkNameLength),
  version: z.string().min(1).max(INGEST_LIMITS.maxSdkVersionLength),
});

const propValue = z.union([
  z.string().max(INGEST_LIMITS.maxPropStringLength),
  z.number().finite(),
  z.boolean(),
]);

const props = z
  .record(z.string().regex(PROP_KEY_PATTERN), propValue)
  .refine((value) => Object.keys(value).length <= INGEST_LIMITS.maxPropsKeys, {
    message: `at most ${INGEST_LIMITS.maxPropsKeys} props`,
  });

// ─── Server events (backend middleware → POST ROUTES.ingest.server) ─────────

export const serverEventSchema = z.object({
  /** Generated ONCE at capture and reused on retries — the idempotency key. */
  eventId: z.uuid(),
  kind: z.enum(SERVER_EVENT_KIND_VALUES).default('http'),
  /** Request START time. */
  occurredAt: isoDateTime,
  method: z.string().toUpperCase().pipe(z.enum(HTTP_METHOD_VALUES)),
  path: wirePath,
  /** e.g. `/ebo-sales/api/stores/:id`. Strongly recommended: without it the server guesses. */
  routeTemplate: routeTemplate.optional(),
  status: z.int().min(100).max(599),
  durationMs: z.number().min(0).max(INGEST_LIMITS.maxDurationMs),
  /** End-user IP resolved through TRUSTED proxy hops. Invalid values are dropped with a warning. */
  ip: z.string().max(64).optional(),
  /** The app's VERIFIED signed-in user. Implausible values are dropped with a warning. */
  userEmail: z.string().max(INGEST_LIMITS.maxEmailLength).optional(),
  requestId: z.string().max(INGEST_LIMITS.maxRequestIdLength).optional(),
  userAgent: z.string().max(INGEST_LIMITS.maxUserAgentWireLength).optional(),
  requestBytes: z.int().min(0).optional(),
  responseBytes: z.int().min(0).optional(),
  /** The app's error CODE (e.g. VALIDATION_ERROR) — never the message. */
  errorCode: z.string().regex(ERROR_CODE_PATTERN).optional(),
  release: z.string().max(INGEST_LIMITS.maxReleaseLength).optional(),
  /** From the X-Nexus-Session / X-Nexus-Page-View headers, when the frontend tracker propagates them. */
  sessionId: z.uuid().optional(),
  pageViewId: z.uuid().optional(),
});

export const serverIngestEnvelopeSchema = z.object({
  /** Stamped by the sender on EVERY send attempt (retries included). */
  sentAt: isoDateTime,
  sdk: sdkInfo.optional(),
  events: z.array(z.unknown()).min(1).max(INGEST_LIMITS.server.maxEvents),
});

export const serverIngestBatchSchema = serverIngestEnvelopeSchema.extend({
  events: z.array(serverEventSchema).min(1).max(INGEST_LIMITS.server.maxEvents),
});

// ─── Browser events (frontend tracker → POST ROUTES.ingest.browser) ─────────

const browserEventBase = {
  eventId: z.uuid(),
  occurredAt: isoDateTime,
  /** Monotonic per session; orders a journey when timestamps tie. */
  seq: z.int().min(0),
  path: wirePath,
  routeTemplate: routeTemplate.optional(),
};

export const pageViewEventSchema = z.object({
  ...browserEventBase,
  type: z.literal('page_view'),
  nav: z.enum(NAV_TYPE_VALUES),
  /** Previous in-app path (no query). */
  referrerPath: wirePath.optional(),
  /** External referrer HOST only — never a full URL. */
  referrerHost: z.string().max(INGEST_LIMITS.maxReferrerHostLength).optional(),
});

export const pageTimeEventSchema = z.object({
  ...browserEventBase,
  type: z.literal('page_time'),
  /** The eventId of the page_view this time belongs to. */
  pageViewId: z.uuid(),
  /** DELTA of visible milliseconds since the previous page_time of this view. */
  visibleMs: z.int().min(0).max(INGEST_LIMITS.maxVisibleMs),
  final: z.boolean(),
  reason: z.enum(PAGE_TIME_REASON_VALUES),
});

export const toolUseEventSchema = z.object({
  ...browserEventBase,
  type: z.literal('tool_use'),
  tool: z.string().regex(TOOL_NAME_PATTERN),
  action: z.enum(TOOL_ACTION_VALUES).optional(),
  /** A STATIC UI label — never user-typed text. */
  label: z.string().max(INGEST_LIMITS.maxLabelLength).optional(),
  value: z.number().finite().optional(),
  props: props.optional(),
});

export const customEventSchema = z.object({
  ...browserEventBase,
  type: z.literal('custom'),
  name: z.string().regex(TOOL_NAME_PATTERN),
  label: z.string().max(INGEST_LIMITS.maxLabelLength).optional(),
  value: z.number().finite().optional(),
  props: props.optional(),
});

export const browserEventSchema = z.discriminatedUnion('type', [
  pageViewEventSchema,
  pageTimeEventSchema,
  toolUseEventSchema,
  customEventSchema,
]);

export const browserIngestEnvelopeSchema = z.object({
  /** Publishable key (`nx_pk_…`). In the body so sendBeacon needs no custom header. */
  key: z.string().min(1).max(64),
  sentAt: isoDateTime,
  /** Per-tab session id (sessionStorage), rotated after 30 min idle or on user change. */
  sessionId: z.uuid(),
  /** Per-device id (localStorage). */
  anonymousId: z.uuid().optional(),
  /** Client HINT only. A verified SSO cookie always wins. */
  user: z.object({ email: z.string().max(INGEST_LIMITS.maxEmailLength).optional() }).optional(),
  client: z
    .object({
      sdk: z.string().max(INGEST_LIMITS.maxSdkNameLength),
      version: z.string().max(INGEST_LIMITS.maxSdkVersionLength),
      tz: z.string().max(64).optional(),
      lang: z.string().max(16).optional(),
    })
    .optional(),
  events: z.array(z.unknown()).min(1).max(INGEST_LIMITS.browser.maxEvents),
});

export const browserIngestBatchSchema = browserIngestEnvelopeSchema.extend({
  events: z.array(browserEventSchema).min(1).max(INGEST_LIMITS.browser.maxEvents),
});

// ─── Responses ──────────────────────────────────────────────────────────────

export const ingestRejectionSchema = z.object({
  index: z.int().min(0),
  code: z.enum(INGEST_EVENT_REJECT_CODES),
  message: z.string(),
});

export const ingestWarningSchema = z.object({
  index: z.int().min(0),
  code: z.enum(INGEST_WARNING_CODES),
  field: z.string(),
});

/** 202 body of both ingest endpoints. NEVER retry a 202. */
export const ingestResultSchema = z.object({
  accepted: z.int().min(0),
  duplicates: z.int().min(0),
  rejected: z.array(ingestRejectionSchema),
  warnings: z.array(ingestWarningSchema),
  dryRun: z.boolean().optional(),
});

/** 200 body of GET ROUTES.ingest.verify. */
export const verifyResponseSchema = z.object({
  app: z.object({ slug: z.string(), displayName: z.string() }),
  keyKind: z.enum(KEY_KIND_VALUES),
  contractVersion: z.int(),
  serverTime: isoDateTime,
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventInput = z.input<typeof serverEventSchema>;
export type ServerIngestEnvelope = z.infer<typeof serverIngestEnvelopeSchema>;
export type ServerIngestBatch = z.infer<typeof serverIngestBatchSchema>;
export type ServerIngestBatchInput = z.input<typeof serverIngestBatchSchema>;

export type PageViewEvent = z.infer<typeof pageViewEventSchema>;
export type PageTimeEvent = z.infer<typeof pageTimeEventSchema>;
export type ToolUseEvent = z.infer<typeof toolUseEventSchema>;
export type CustomEvent = z.infer<typeof customEventSchema>;
export type BrowserEvent = z.infer<typeof browserEventSchema>;
export type BrowserIngestEnvelope = z.infer<typeof browserIngestEnvelopeSchema>;
export type BrowserIngestBatch = z.infer<typeof browserIngestBatchSchema>;
export type BrowserIngestBatchInput = z.input<typeof browserIngestBatchSchema>;

export type IngestRejection = z.infer<typeof ingestRejectionSchema>;
export type IngestWarning = z.infer<typeof ingestWarningSchema>;
export type IngestResultDto = z.infer<typeof ingestResultSchema>;
export type VerifyResponseDto = z.infer<typeof verifyResponseSchema>;
