/**
 * The browser tracker: turns navigation, visibility and clicks into contract events.
 *
 * WHY THIS CLASS EXISTS
 * It is the orchestrator — each concern lives in its own module (session-store, visible-timer,
 * event-batcher, transport, tool-capture, fetch-patch) and this class only wires them to the DOM
 * and to the React hook. Every public method is wrapped so the tracker NEVER throws into the app.
 */
import { INGEST_HEADERS, SDK_DEFAULTS, type PageTimeReason } from '@nexus/shared/constants';

import { EventBatcher, type EnvelopeContext } from './event-batcher';
import { installFetchPatch } from './fetch-patch';
import { externalReferrerHost, toWirePath } from './paths';
import { browserLocalStorage, browserSessionStorage } from './safe-storage';
import { cleanEmail, cleanTrackOptions, isValidName, type TrackOptions } from './sanitize';
import { SDK_NAME, SDK_VERSION } from './sdk-info';
import { AnonymousIdStore, SessionStore } from './session-store';
import { toolFromClickTarget } from './tool-capture';
import { beaconTransport, type Transport } from './transport';
import { createUuid } from './uuid';
import { VisibleTimer } from './visible-timer';
import type { BrowserWireBatch, BrowserWireEvent, WireEventBody } from './wire';

export interface BrowserTrackerConfig {
  /** Absolute ingest URL (already resolved by `resolveIngestUrl`). */
  ingestUrl: string;
  publishableKey: string;
  autoTools: boolean;
  propagateHeaders: boolean;
  /** Injected for tests; defaults to sendBeacon + keepalive fetch. */
  transport?: Transport;
}

interface PageViewState {
  id: string;
  path: string;
  /** true once a `final` page_time was sent (pagehide) — no second final for this view. */
  ended: boolean;
}

export class BrowserTracker {
  private readonly session = new SessionStore(
    browserSessionStorage(),
    SDK_DEFAULTS.browser.sessionIdleMs,
  );
  private readonly anonymous = new AnonymousIdStore(browserLocalStorage());
  private readonly timer = new VisibleTimer();
  private readonly batcher: EventBatcher;
  private readonly client = clientInfo();

  private email: string | undefined;
  private view: PageViewState | undefined;
  private lastPath: string | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private releaseFetch: (() => void) | undefined;
  private started = false;
  private autoTools: boolean;
  private propagateHeaders: boolean;

  constructor(private readonly config: BrowserTrackerConfig) {
    const transport = config.transport ?? beaconTransport;
    this.batcher = new EventBatcher(
      (context, events) => this.serialize(context, events),
      (json) => transport(config.ingestUrl, json),
    );
    this.autoTools = config.autoTools;
    this.propagateHeaders = config.propagateHeaders;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** WHY: attaches DOM listeners and the flush timer. Idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    guard(() => {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('pageshow', this.onPageShow);
      this.applyOptions();
      this.interval = setInterval(this.onInterval, SDK_DEFAULTS.browser.flushIntervalMs);
    });
  }

  /** WHY: the view ends with the tracker (unmount) — send the remainder, then detach everything. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    guard(() => {
      this.endView('route');
      this.batcher.flush();
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
      document.removeEventListener('click', this.onClick, true);
      if (this.interval !== undefined) clearInterval(this.interval);
      this.interval = undefined;
      this.releaseFetch?.();
      this.releaseFetch = undefined;
    });
  }

  /** WHY: lets the hook toggle `autoTools` / `propagateHeaders` without restarting the session. */
  setOptions(options: { autoTools: boolean; propagateHeaders: boolean }): void {
    this.autoTools = options.autoTools;
    this.propagateHeaders = options.propagateHeaders;
    if (this.started) guard(() => this.applyOptions());
  }

  // ─── Inputs from the hook ─────────────────────────────────────────────────

  /** WHY: the user hint travels in the envelope and drives session rotation on user change. */
  setUser(email: string | undefined): void {
    this.email = cleanEmail(email);
  }

  /**
   * WHY: a new path = the previous view ends (`page_time`, final, reason `route`) and a new
   * `page_view` starts. The first one of the document is `nav: 'load'`. Same path → nothing.
   */
  setPath(pathname: string): void {
    guard(() => {
      const path = toWirePath(pathname);
      if (this.view && this.view.path === path) return;
      const isFirst = this.lastPath === undefined;
      this.endView('route');
      this.startView(path, isFirst ? 'load' : 'route', this.lastPath);
    });
  }

  /** WHY: manual tool tracking for anything the data attributes cannot express. */
  trackTool(tool: string, options?: TrackOptions): void {
    guard(() => {
      if (!this.view || !isValidName(tool)) return;
      this.emit({ type: 'tool_use', tool, ...cleanTrackOptions(options) });
    });
  }

  /** WHY: `custom` events — same rules as tools, but `name` and no `action`. */
  trackEvent(name: string, options?: Omit<TrackOptions, 'action'>): void {
    guard(() => {
      if (!this.view || !isValidName(name)) return;
      const { action: _ignored, ...fields } = cleanTrackOptions(options);
      this.emit({ type: 'custom', name, ...fields });
    });
  }

  /** WHY: exposed so tests and `pagehide`-like host events can force a send. */
  flush(): void {
    guard(() => this.batcher.flush());
  }

  // ─── Page views and time ──────────────────────────────────────────────────

  private startView(path: string, nav: 'load' | 'route', referrerPath: string | undefined): void {
    const now = Date.now();
    const referrerHost =
      nav === 'load' ? externalReferrerHost(document.referrer, window.location.host) : undefined;
    const id = this.emit(
      {
        type: 'page_view',
        nav,
        ...(referrerPath ? { referrerPath } : {}),
        ...(referrerHost ? { referrerHost } : {}),
      },
      path,
    );
    this.view = { id, path, ended: false };
    this.lastPath = path;
    this.timer.reset(now, isVisible());
  }

  /** WHY: the final delta of the current view (route change, unmount, pagehide). */
  private endView(reason: Extract<PageTimeReason, 'route' | 'pagehide'>): void {
    if (!this.view || this.view.ended) return;
    this.emitPageTime(reason, true);
    this.view.ended = true;
  }

  /** WHY: one place builds `page_time`; non-final zero deltas are skipped (they carry nothing). */
  private emitPageTime(reason: PageTimeReason, final: boolean): void {
    if (!this.view || this.view.ended) return;
    const visibleMs = this.timer.take(Date.now());
    if (!final && visibleMs === 0) return;
    this.emit(
      { type: 'page_time', pageViewId: this.view.id, visibleMs, final, reason },
      this.view.path,
    );
  }

  /** WHY: stamps id/time/seq/path and queues; returns the event id (page views need it). */
  private emit(body: WireEventBody, path = this.view?.path): string {
    const now = Date.now();
    const eventId = createUuid();
    if (!path) return eventId;
    const { sessionId, seq } = this.session.nextEvent(this.email, now);
    const event = {
      ...body,
      eventId,
      occurredAt: new Date(now).toISOString(),
      seq,
      path,
    } as BrowserWireEvent;
    this.batcher.enqueue(event, { sessionId, ...(this.email ? { email: this.email } : {}) });
    return eventId;
  }

  private serialize(context: EnvelopeContext, events: BrowserWireEvent[]): string {
    const batch: BrowserWireBatch = {
      key: this.config.publishableKey,
      sentAt: new Date().toISOString(),
      sessionId: context.sessionId,
      anonymousId: this.anonymous.get(),
      ...(context.email ? { user: { email: context.email } } : {}),
      client: this.client,
      events,
    };
    return JSON.stringify(batch);
  }

  // ─── DOM listeners (arrow properties so add/remove get the same reference) ─

  private readonly onVisibilityChange = (): void => {
    guard(() => {
      const now = Date.now();
      if (isVisible()) {
        this.timer.resume(now);
        return;
      }
      this.timer.pause(now);
      this.emitPageTime('hidden', false);
      this.batcher.flush();
    });
  };

  private readonly onPageHide = (): void => {
    guard(() => {
      this.timer.pause(Date.now());
      this.endView('pagehide');
      this.batcher.flush();
    });
  };

  /** WHY: a page restored from the back/forward cache is a new view of the same path. */
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    guard(() => {
      if (!event.persisted || !this.view?.ended) return;
      this.startView(this.view.path, 'load', undefined);
    });
  };

  private readonly onInterval = (): void => {
    guard(() => {
      if (isVisible()) this.emitPageTime('idle', false);
      this.batcher.flush();
    });
  };

  private readonly onClick = (event: MouseEvent): void => {
    guard(() => {
      const captured = toolFromClickTarget(event.target);
      if (!captured || !this.view) return;
      this.emit({ type: 'tool_use', ...captured });
    });
  };

  /** WHY: attach/detach the optional features to match the current options. */
  private applyOptions(): void {
    document.removeEventListener('click', this.onClick, true);
    if (this.autoTools) document.addEventListener('click', this.onClick, true);
    if (this.propagateHeaders && !this.releaseFetch) {
      this.releaseFetch = installFetchPatch({
        excludeUrl: this.config.ingestUrl,
        headers: () => this.propagatedHeaders(),
      });
    } else if (!this.propagateHeaders && this.releaseFetch) {
      this.releaseFetch();
      this.releaseFetch = undefined;
    }
  }

  private propagatedHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      [INGEST_HEADERS.session]: this.session.peek(this.email, Date.now()),
    };
    if (this.view && !this.view.ended) headers[INGEST_HEADERS.pageView] = this.view.id;
    return headers;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function clientInfo(): NonNullable<BrowserWireBatch['client']> {
  const client: NonNullable<BrowserWireBatch['client']> = { sdk: SDK_NAME, version: SDK_VERSION };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) client.tz = tz.slice(0, 64);
  } catch {
    // optional
  }
  try {
    const lang = typeof navigator === 'undefined' ? undefined : navigator.language;
    if (lang) client.lang = lang.slice(0, 16);
  } catch {
    // optional
  }
  return client;
}

/** WHY: the tracker's last line of defence — NOTHING it does may throw into the host app. */
function guard(fn: () => void): void {
  try {
    fn();
  } catch {
    // swallowed by design
  }
}
