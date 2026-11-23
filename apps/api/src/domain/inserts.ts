/**
 * Enriched, validated records ready to INSERT (camelCase). Produced ONLY by the wire→row mappers
 * (`toApiRequestInsert` / `toWebEventInsert`) and consumed ONLY by the ingest repositories.
 */
import type {
  AuditAction,
  BrowserEventType,
  Environment,
  HttpMethod,
  IdentitySource,
  IngestRejectionCode,
  IngestSource,
  IpClass,
  KeyKind,
  NavType,
  PageTimeReason,
  PersonAccessSurface,
  PiiField,
  PiiKind,
  ServerEventKind,
  ToolAction,
} from '@nexus/shared';

/** Identity + network fields common to both event tables. */
export interface ActorColumns {
  userEmail: string | null;
  /** HMAC-SHA256(USER_KEY_SECRET, userEmail); null iff userEmail is null. */
  userKey: Buffer | null;
  claimedEmail: string | null;
  identitySource: IdentitySource;
  /** Stored per IP_STORAGE_MODE (full / truncated) or null (hashed mode / no IP). */
  ip: string | null;
  ipHash: Buffer | null;
  ipClass: IpClass;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  geoLat: number | null;
  geoLon: number | null;
  uaBrowser: string | null;
  uaOs: string | null;
  uaDevice: string | null;
  sdk: string | null;
}

/**
 * @see ../../migrations/0004_api_requests.sql
 * @see ../../migrations/0007_event_environment_and_client_context.sql (environment)
 */
export interface ApiRequestInsert extends ActorColumns {
  occurredAt: Date;
  eventId: string;
  clockSkewMs: number | null;
  appId: string;
  endpointId: string;
  kind: ServerEventKind;
  method: HttpMethod;
  routeTemplate: string;
  path: string;
  statusCode: number;
  durationMs: number;
  requestBytes: number | null;
  responseBytes: number | null;
  errorCode: string | null;
  release: string | null;
  requestId: string | null;
  sessionId: string | null;
  pageViewId: string | null;
  /** Resolved by domain/environment.ts (NOT an ActorColumn: one value per batch, not per actor). */
  environment: Environment;
}

/**
 * @see ../../migrations/0005_web_events.sql
 * @see ../../migrations/0007_event_environment_and_client_context.sql (environment, client_tz, client_lang, release)
 */
export interface WebEventInsert extends ActorColumns {
  occurredAt: Date;
  eventId: string;
  clockSkewMs: number | null;
  appId: string;
  sessionId: string;
  anonymousId: string | null;
  seq: number;
  eventType: BrowserEventType;
  path: string;
  pathTemplate: string;
  referrerPath: string | null;
  referrerHost: string | null;
  nav: NavType | null;
  pageViewId: string | null;
  visibleMs: number | null;
  isFinal: boolean | null;
  timeReason: PageTimeReason | null;
  tool: string | null;
  action: ToolAction | null;
  label: string | null;
  value: number | null;
  name: string | null;
  props: Record<string, string | number | boolean> | null;
  environment: Environment;
  /** client.tz when it matches CLIENT_TZ_PATTERN, else null. */
  clientTz: string | null;
  /** client.lang when it matches CLIENT_LANG_PATTERN, else null. */
  clientLang: string | null;
  /** The envelope `release` (the frontend build), PII-scrubbed; null when absent. */
  release: string | null;
}

export interface NewApp {
  slug: string;
  displayName: string;
  basePath: string | null;
  allowedOrigins: string[];
  browserIngestEnabled: boolean;
  createdBy: string;
}

export interface AppPatch {
  displayName?: string;
  basePath?: string | null;
  allowedOrigins?: string[];
  browserIngestEnabled?: boolean;
  isActive?: boolean;
}

export interface NewApiKey {
  appId: string;
  kind: KeyKind;
  keyPrefix: string;
  keyHash: Buffer;
  publicKey: string | null;
  label: string;
  createdBy: string;
}

export interface AuditEntry {
  actorEmail: string;
  action: AuditAction;
  targetType: 'app' | 'api_key';
  targetId: string;
  details?: Record<string, unknown>;
}

export interface IngestCounterIncrement {
  appId: string;
  source: IngestSource;
  accepted: number;
  duplicates: number;
  rejected: number;
  rateLimited: number;
}

/**
 * One (source, sdk, code, schema_path) rejection count of a batch. `''` = none (sdk / schema_path).
 * @see ../../migrations/0010_ingest_rejections.sql
 */
export interface IngestRejectionIncrement {
  source: IngestSource;
  sdk: string;
  code: IngestRejectionCode;
  schemaPath: string;
  rejected: number;
}

/** One (field, kind) PII detection count of a batch. @see ../../migrations/0011_pii_detections.sql */
export interface PiiDetectionIncrement {
  field: PiiField;
  kind: PiiKind;
  detections: number;
}

/**
 * One person-page open to append to the access log. `subjectEmailMasked` is ALREADY masked
 * (maskEmail, src/lib/redact.ts): the full address of the person is never written here.
 * @see ../../migrations/0013_person_access_log.sql
 */
export interface PersonAccessInsert {
  viewerEmail: string;
  subjectUserKey: Buffer;
  subjectEmailMasked: string;
  surface: PersonAccessSurface;
}
