/**
 * Wire types of the browser ingest contract v1, as plain TypeScript.
 *
 * WHY THIS FILE EXISTS
 * The zod schemas in `@nexus/shared/ingest` are the source of truth, but importing their inferred
 * types would drag zod into this package's published `.d.ts` (and zod is NOT a dependency of the
 * SDK). These hand-written mirrors are checked against `browserIngestBatchSchema` in the tests, so
 * drift fails the build.
 */
import type {
  NavType,
  PageTimeReason,
  SdkCaptureModule,
  ToolAction,
} from '@nexus/shared/constants';

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

interface WireEventBase {
  eventId: string;
  occurredAt: string;
  seq: number;
  path: string;
  routeTemplate?: string;
}

export interface PageViewWireEvent extends WireEventBase {
  type: 'page_view';
  nav: NavType;
  referrerPath?: string;
  referrerHost?: string;
}

export interface PageTimeWireEvent extends WireEventBase {
  type: 'page_time';
  pageViewId: string;
  visibleMs: number;
  final: boolean;
  reason: PageTimeReason;
}

export interface ToolUseWireEvent extends WireEventBase {
  type: 'tool_use';
  tool: string;
  action?: ToolAction;
  label?: string;
  value?: number;
  props?: Props;
}

export interface CustomWireEvent extends WireEventBase {
  type: 'custom';
  name: string;
  label?: string;
  value?: number;
  props?: Props;
}

export type BrowserWireEvent =
  | PageViewWireEvent
  | PageTimeWireEvent
  | ToolUseWireEvent
  | CustomWireEvent;

/** The fields every event shares, minus what the tracker stamps (`eventId`, `occurredAt`, `seq`). */
export type WireEventBody =
  | Omit<PageViewWireEvent, keyof WireEventBase>
  | Omit<PageTimeWireEvent, keyof WireEventBase>
  | Omit<ToolUseWireEvent, keyof WireEventBase>
  | Omit<CustomWireEvent, keyof WireEventBase>;

export interface BrowserWireBatch {
  key: string;
  sentAt: string;
  sessionId: string;
  anonymousId?: string;
  user?: { email?: string };
  /** `prod` | `staging` | `dev` (ADR 0008); omitted → the server default. */
  environment?: string;
  /** The frontend build (≤ 64 chars). */
  release?: string;
  /** `replay: true` ONLY on a cross-load replay of the retry queue (ADR 0012). */
  client?: { sdk: string; version: string; tz?: string; lang?: string; replay?: boolean };
  events: BrowserWireEvent[];
}

/** Body of POST ROUTES.ingest.config (mirrors `sdkConfigRequestSchema`). */
export interface SdkConfigWireRequest {
  key: string;
  client?: { sdk: string; version: string };
}

/** 200 body of POST ROUTES.ingest.config (mirrors `sdkRemoteConfigSchema`). */
export interface SdkRemoteConfigWire {
  contract: 1;
  version: number;
  enabled: boolean;
  disabledModules: SdkCaptureModule[];
  maxAgeMs: number;
}
