/**
 * The browser tracker: turns navigation, visibility and clicks into contract events.
 *
 * WHY THIS CLASS EXISTS
 * It is the orchestrator — each concern lives in its own module (session-store, visible-timer,
 * event-batcher, batch-sender + transport, retry-queue, remote-config, header-source + the
 * fetch/XHR patches, tool-capture) and this class only wires them to the DOM and to the React
 * hook. Every public method is wrapped so the tracker NEVER throws into the app.
 *
 * MODULE GATE: `isModuleOn(m)` is the single check for the kill switch and the remote module
 * switches (ADR 0009). Remote config can only turn a module OFF.
 *
 * KILLED, THEN LIFTED: while disabled (a cached kill at start, or a kill code in the page) the
 * tracker keeps ONE slow timer that re-asks the config every `disabledRecheckMs`; a valid 200
 * re-arms it in place (`enable()`, via `applyEnabledForScope`).
 */
import {
  INGEST_LIMITS,
  SDK_DEFAULTS,
  type PageTimeReason,
  type SdkCaptureModule,
} from '@nexus/shared/constants';

import { BatchSender } from './batch-sender';
import { EventBatcher, type EnvelopeContext } from './event-batcher';
import { cleanEnvironment, cleanRelease, defaultEnvironment, type NexusEnvironment } from './environment';
import { installFetchPatch, releaseFetchPatchIfOurs } from './fetch-patch';
import { captureNativeFetch, globalState, sharedSessionStore, type TrackerLike } from './global-state';
import { createHeaderSource, type HeaderSource } from './header-source';
import { ingestExcludeUrls } from './ingest-urls';
import { applyDisabledForScope } from './kill';
import { externalReferrerHost, toWirePath } from './paths';
import { applyCachedConfig, RemoteConfigClient } from './remote-config';
import { PersistentRetryQueue } from './retry-queue';
import { toWireRouteTemplate } from './route-template';
import { browserLocalStorage } from './safe-storage';
import { cleanEmail, cleanTrackOptions, isValidName, type TrackOptions } from './sanitize';
import { SDK_NAME, SDK_VERSION, keyScope } from './sdk-info';
import { AnonymousIdStore } from './session-store';
import { pruneStaleScopes } from './stale-scopes';
import { countStat } from './stats';
import { toolFromClickTarget } from './tool-capture';
import { defaultTransport, type Transport } from './transport';
import { createUuid } from './uuid';
import { VisibleTimer } from './visible-timer';
import type { BrowserWireBatch, BrowserWireEvent, WireEventBody } from './wire';
import { installXhrPatch, releaseXhrPatchIfOurs } from './xhr-patch';

/** The options the hook can change without restarting the tracker (`setOptions`). */
export interface BrowserTrackerOptions {
  autoTools: boolean;
  propagateHeaders: boolean;
  /** Exact extra origins that may receive the propagated headers (never set remotely). */
  propagateHeadersTo: readonly string[];
  environment: NexusEnvironment | undefined;
  release: string | undefined;
  /** Ask POST ROUTES.ingest.config for module switches and the kill switch. */
  remoteConfig: boolean;
  /** Persist failed batches to localStorage and replay them on the next load. */
  persistRetries: boolean;
}

export interface BrowserTrackerConfig extends BrowserTrackerOptions {
  /** NEXUS_URL as the app passed it (the config endpoint is derived from it). */
  url: string;
  /** Absolute ingest URL (already resolved by `resolveIngestUrl`). */
  ingestUrl: string;
  publishableKey: string;
  /** Injected for tests; defaults to the native fetch (live) + sendBeacon (unload). */
  transport?: Transport;
}

interface PageViewState {
  id: string;
  path: string;
  routeTemplate: string | undefined;
  /** The session the page_view was sent in (the page-view header is paired with it). */
  sessionId: string;
  /** false when its page_view was suppressed (killed / module off) — re-sent when re-armed. */
  sent: boolean;
  /** true once a `final` page_time was sent (pagehide) — no second final for this view. */
  ended: boolean;
}

export class BrowserTracker implements TrackerLike {
  readonly keyScope: string;
  private readonly anonymous = new AnonymousIdStore(browserLocalStorage());
  private readonly timer = new VisibleTimer();
  private readonly batcher: EventBatcher;
  private readonly sender: BatchSender;
  private readonly retry: PersistentRetryQueue;
  private readonly remote = new RemoteConfigClient();
  private readonly transport: Transport;
  private readonly client = clientInfo();

  private options: BrowserTrackerOptions;
  private email: string | undefined;
  private view: PageViewState | undefined;
  private lastPath: string | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  /** The slow config re-check while killed (ADR 0009). */
  private recheck: ReturnType<typeof setInterval> | undefined;
  /** true once this tracker sent any page_view (a re-armed view is then a `route`). */
  private sentAnyView = false;
  private headerSource: HeaderSource | undefined;
  private started = false;
  private disabled = false;

  constructor(private readonly config: BrowserTrackerConfig) {
    this.keyScope = keyScope(config.publishableKey);
    this.options = pickOptions(config);
    this.transport = config.transport ?? defaultTransport;
    this.retry = new PersistentRetryQueue(this.keyScope);
    this.sender = new BatchSender({
      url: config.ingestUrl,
      transport: this.transport,
      persist: (json, attempts) => this.persist(json, attempts),
      forget: (json) => this.retry.forget(JSON.parse(json) as BrowserWireBatch),
      onDisabled: () => applyDisabledForScope(this.keyScope),
      onOverflow: () => countStat('droppedOverflow'),
    });
    this.batcher = new EventBatcher(
      (context, events) => this.serialize(context, events),
      (json, mode) => this.sender.send(json, mode),
      undefined,
      () => countStat('droppedOverflow'),
    );
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * WHY: captures the native fetch FIRST (before any patch), applies the cached remote config
   * synchronously (a known kill wins), then attaches listeners, refreshes the config and only
   * then replays the persisted queue (never into a key that just got killed). Idempotent.
   */
  start(): void {
    if (this.started) return;
    this.started = true;
    guard(() => {
      captureNativeFetch();
      pruneStaleScopes(this.keyScope);
      if (!applyCachedConfig(this.keyScope)) {
        this.disabled = true;
        this.armRecheck();
        void this.scheduleConfigRefresh();
        return;
      }
      this.attach();
      void this.scheduleConfigRefresh().then(() => this.drainRetries());
    });
  }

  /** WHY: the view ends with the tracker (unmount) — send the remainder, then detach everything. */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    guard(() => {
      this.endView('route');
      this.batcher.flush('live');
      this.detach();
    });
  }

  /** WHY: kill switch (called by `applyDisabledForScope`) — nothing is sent from now on. */
  disable(): void {
    guard(() => {
      this.disabled = true;
      this.batcher.clear();
      this.sender.stop();
      this.detach();
      if (this.started) this.armRecheck();
    });
  }

  /**
   * WHY: the kill was lifted (called by `applyEnabledForScope` after a valid 200 config) - capture
   * again in this page: listeners, interval, options, the replay of persisted batches, and the
   * page_view of the current view if the kill had suppressed it.
   */
  enable(): void {
    guard(() => {
      if (!this.disabled) return;
      this.disabled = false;
      this.clearRecheck();
      this.sender.resume();
      if (!this.started) return;
      this.attach();
      const view = this.view;
      if (view && !view.sent && this.isModuleOn('page_view')) {
        this.startView(view.path, view.routeTemplate, this.sentAnyView ? 'route' : 'load', undefined);
      }
      void this.drainRetries();
    });
  }

  /** WHY: lets the hook change ANY option without restarting the session. */
  setOptions(options: BrowserTrackerOptions): void {
    this.options = pickOptions(options);
    if (this.started && !this.disabled) guard(() => this.applyOptions());
  }

  // ─── Inputs from the hook ─────────────────────────────────────────────────

  /** WHY: the user hint travels in the envelope and drives session rotation on user change. */
  setUser(email: string | undefined): void {
    this.email = cleanEmail(email);
  }

  /**
   * WHY: a new path = the previous view ends (`page_time`, final, reason `route`) and a new
   * `page_view` starts. The first one of the document is `nav: 'load'`. Same path → nothing
   * (but a template that became known is kept). The template is stamped on EVERY event of the view.
   */
  setPath(pathname: string, routeTemplate?: string | null): void {
    guard(() => {
      const path = toWirePath(pathname);
      const template = toWireRouteTemplate(routeTemplate);
      if (this.view && this.view.path === path) {
        if (template) this.view.routeTemplate = template;
        return;
      }
      const isFirst = this.lastPath === undefined;
      this.endView('route');
      this.startView(path, template, isFirst ? 'load' : 'route', this.lastPath);
    });
  }

  /** WHY: manual tool tracking for anything the data attributes cannot express. */
  trackTool(tool: string, options?: TrackOptions): void {
    guard(() => {
      if (!this.view || !isValidName(tool) || !this.isModuleOn('manual_tools')) return;
      this.emit({ type: 'tool_use', tool, ...cleanTrackOptions(options) });
    });
  }

  /** WHY: `custom` events — same rules as tools, but `name` and no `action`. */
  trackEvent(name: string, options?: Omit<TrackOptions, 'action'>): void {
    guard(() => {
      if (!this.view || !isValidName(name) || !this.isModuleOn('custom')) return;
      const { action: _ignored, ...fields } = cleanTrackOptions(options);
      this.emit({ type: 'custom', name, ...fields });
    });
  }

  /** WHY: exposed so tests and `flushNexus()` can force a send. */
  flush(): void {
    guard(() => this.batcher.flush('live'));
  }

  /** WHY: the page-view header of propagated requests (also after the view ended). */
  currentView(): { id: string; sessionId: string } | null {
    return this.view ? { id: this.view.id, sessionId: this.view.sessionId } : null;
  }

  queuedCount(): number {
    return this.batcher.size();
  }

  // ─── Page views and time ──────────────────────────────────────────────────

  private startView(
    path: string,
    routeTemplate: string | undefined,
    nav: 'load' | 'route',
    referrerPath: string | undefined,
  ): void {
    const now = Date.now();
    const referrerHost =
      nav === 'load' ? externalReferrerHost(document.referrer, window.location.host) : undefined;
    const pendingId = nav === 'load' ? consumePendingPageViewId() : undefined;
    const eventId = pendingId ?? createUuid();
    this.view = { id: eventId, path, routeTemplate, sessionId: '', ended: false, sent: false };
    if (this.isModuleOn('page_view')) {
      // A pre-allocated id was already sent by the early headers, paired with the CURRENT session:
      // the view must land in that same session, so a not-yet-known user (auth resolves after the
      // first render) does not rotate it (ADR 0011).
      this.view.sessionId = this.emit(
        {
          type: 'page_view',
          nav,
          ...(referrerPath ? { referrerPath } : {}),
          ...(referrerHost ? { referrerHost } : {}),
        },
        eventId,
        pendingId !== undefined,
      );
      this.view.sent = true;
      this.sentAnyView = true;
    } else {
      this.view.sessionId = sharedSessionStore().peekCurrent(now);
    }
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
    if (!this.isModuleOn('page_time')) return;
    this.emit({ type: 'page_time', pageViewId: this.view.id, visibleMs, final, reason });
  }

  /**
   * WHY: stamps id/time/seq/path/template and queues; returns the session id it was sent in.
   * `keepSessionForUnknownUser`: see SessionStore.nextEvent.
   */
  private emit(body: WireEventBody, eventId: string = createUuid(), keepSessionForUnknownUser = false): string {
    const view = this.view;
    const now = Date.now();
    if (!view || this.disabled) return sharedSessionStore().peekCurrent(now);
    const { sessionId, seq } = sharedSessionStore().nextEvent(this.email, now, keepSessionForUnknownUser);
    const event = {
      ...body,
      eventId,
      occurredAt: new Date(now).toISOString(),
      seq,
      path: view.path,
      ...(view.routeTemplate ? { routeTemplate: view.routeTemplate } : {}),
    } as BrowserWireEvent;
    this.batcher.enqueue(event, { sessionId, ...(this.email ? { email: this.email } : {}) });
    return sessionId;
  }

  private serialize(context: EnvelopeContext, events: BrowserWireEvent[]): string {
    const environment =
      cleanEnvironment(this.options.environment) ?? defaultEnvironment(currentHostname());
    const release = cleanRelease(this.options.release);
    const batch: BrowserWireBatch = {
      key: this.config.publishableKey,
      sentAt: new Date().toISOString(),
      sessionId: context.sessionId,
      anonymousId: this.anonymous.get(),
      ...(context.email ? { user: { email: context.email } } : {}),
      ...(environment ? { environment } : {}),
      ...(release ? { release } : {}),
      client: this.client,
      events,
    };
    return JSON.stringify(batch);
  }

  // ─── Delivery: remote config and the retry queue ──────────────────────────

  /** WHY: one gate for the kill switch and the remote module switches. */
  private isModuleOn(module: SdkCaptureModule): boolean {
    if (this.disabled) return false;
    const state = globalState();
    if (state.disabledKeys.has(this.keyScope)) return false;
    return !state.remote.get(this.keyScope)?.disabledModules.includes(module);
  }

  private retriesOn(): boolean {
    return this.options.persistRetries && this.isModuleOn('retry_queue');
  }

  private persist(json: string, attempts: number): boolean {
    if (!this.retriesOn()) return false;
    return this.retry.persist(JSON.parse(json) as BrowserWireBatch, attempts);
  }

  private async drainRetries(): Promise<void> {
    if (!this.started || !this.retriesOn()) return;
    await this.retry.drain((envelope) => this.sender.sendOnce(JSON.stringify(envelope)));
  }

  /** WHY: the network is asked only when the cache is due (checked inside); never blocks. */
  private scheduleConfigRefresh(): Promise<void> {
    if (!this.options.remoteConfig) return Promise.resolve();
    return this.remote.refresh(this.config.url, this.config.publishableKey, {
      sdk: SDK_NAME,
      version: SDK_VERSION,
    });
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
      this.flushForUnload();
    });
  };

  private readonly onPageHide = (): void => {
    guard(() => {
      this.timer.pause(Date.now());
      this.endView('pagehide');
      this.flushForUnload();
    });
  };

  /** WHY: a page restored from the back/forward cache is a new view of the same path. */
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    guard(() => {
      if (!event.persisted || !this.view?.ended) return;
      this.startView(this.view.path, this.view.routeTemplate, 'load', undefined);
    });
  };

  private readonly onInterval = (): void => {
    guard(() => {
      if (isVisible()) this.emitPageTime('idle', false);
      this.batcher.flush('live');
      void this.scheduleConfigRefresh();
    });
  };

  private readonly onClick = (event: MouseEvent): void => {
    guard(() => {
      if (!this.isModuleOn('auto_tools')) return;
      const captured = toolFromClickTarget(event.target);
      if (!captured || !this.view) return;
      this.emit({ type: 'tool_use', ...captured });
    });
  };

  /** WHY: the page may be going away — beacon what is queued, persist what already failed. */
  private flushForUnload(): void {
    this.batcher.flush('unload');
    this.sender.unload();
  }

  /** WHY: the listeners, the options and the flush/config interval of a capturing tracker. */
  private attach(): void {
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    this.applyOptions();
    if (this.interval === undefined) {
      this.interval = setInterval(this.onInterval, SDK_DEFAULTS.browser.flushIntervalMs);
    }
  }

  /** WHY: while killed, re-ask the config at the (slow) recheck cadence - the lift needs a 200. */
  private armRecheck(): void {
    if (this.recheck !== undefined || !this.options.remoteConfig) return;
    this.recheck = setInterval(() => {
      guard(() => void this.scheduleConfigRefresh());
    }, SDK_DEFAULTS.browser.disabledRecheckMs);
  }

  private clearRecheck(): void {
    if (this.recheck !== undefined) clearInterval(this.recheck);
    this.recheck = undefined;
  }

  /** WHY: attach/detach the optional features to match the current options. */
  private applyOptions(): void {
    document.removeEventListener('click', this.onClick, true);
    if (this.options.autoTools) document.addEventListener('click', this.onClick, true);
    this.detachHeaderSource();
    if (this.options.propagateHeaders && this.isModuleOn('header_propagation')) {
      this.attachHeaderSource();
    }
  }

  private attachHeaderSource(): void {
    const source = createHeaderSource({
      keyScope: this.keyScope,
      excludeUrls: ingestExcludeUrls(this.config.url),
      allowOrigins: this.options.propagateHeadersTo,
      pageView: () => this.currentView(),
    });
    this.headerSource = source;
    globalState().headerSources.add(source);
    installFetchPatch();
    installXhrPatch();
  }

  /** WHY: the patches go when the LAST source goes (the early source is permanent). */
  private detachHeaderSource(): void {
    if (!this.headerSource) return;
    const state = globalState();
    state.headerSources.delete(this.headerSource);
    this.headerSource = undefined;
    if (state.headerSources.size === 0) {
      releaseFetchPatchIfOurs();
      releaseXhrPatchIfOurs();
    }
  }

  private detach(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('click', this.onClick, true);
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
    this.clearRecheck();
    this.detachHeaderSource();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickOptions(options: BrowserTrackerOptions): BrowserTrackerOptions {
  return {
    autoTools: options.autoTools,
    propagateHeaders: options.propagateHeaders,
    propagateHeadersTo: [...options.propagateHeadersTo],
    environment: options.environment,
    release: options.release,
    remoteConfig: options.remoteConfig,
    persistRetries: options.persistRetries,
  };
}

/** WHY: the early entry pre-allocated the id its headers already carry — the first view takes it. */
function consumePendingPageViewId(): string | undefined {
  const state = globalState();
  const id = state.pendingPageViewId;
  state.pendingPageViewId = null;
  return id ?? undefined;
}

function isVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function currentHostname(): string | undefined {
  try {
    return window.location.hostname;
  } catch {
    return undefined;
  }
}

function clientInfo(): NonNullable<BrowserWireBatch['client']> {
  const client: NonNullable<BrowserWireBatch['client']> = { sdk: SDK_NAME, version: SDK_VERSION };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) client.tz = tz.slice(0, INGEST_LIMITS.maxClientTzLength);
  } catch {
    // optional
  }
  try {
    const lang = typeof navigator === 'undefined' ? undefined : navigator.language;
    if (lang) client.lang = lang.slice(0, INGEST_LIMITS.maxClientLangLength);
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
