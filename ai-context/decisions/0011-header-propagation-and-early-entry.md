# ADR 0011 — Header propagation v2, the early entry and the XHR patch

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
  **Supersedes** the [ADR 0001](0001-contract-and-naming.md) row "Session ↔ API correlation … when
  `propagateHeaders` is on (opt-in)".
- **Context:** linking a backend API call to the page view that caused it needs `X-Nexus-Session` /
  `X-Nexus-Page-View` on the call. With propagation opt-in almost nobody linked; the tracker mounts
  after hydration, so the first calls of every page (data clients created at module load,
  `openapi-fetch`'s captured `fetch`) went out bare; and axios uses `XMLHttpRequest`, which was not
  patched at all. The SDK's own requests also went through whatever fetch interceptor the host had
  installed.
- **Decision:**
  1. **Default on, same-origin only.** `propagateHeaders` defaults to `true` for same-origin requests
     (same-origin custom headers never preflight). Extra origins only through the exact list
     `propagateHeadersTo`, never set by remote config; the docs warn that the target API must allow
     both headers in CORS. Relative URLs resolve against `document.baseURI` (a `<base href>`), as
     fetch and XHR do. The check sees the request's FIRST URL only: a same-origin call redirected to
     another origin (a presigned download URL) keeps the headers and needs that target's CORS to
     allow them — documented in the README, guide chapter 3 and troubleshooting (remedy: allow the
     headers there, or `propagateHeaders: false`). A `Request` input keeps its own `referrer` /
     `referrerPolicy` (a non-empty init would otherwise reset them).
  2. **Excluded URLs:** every `ROUTES.ingest.*` path under the collector base (`resolveIngestUrl`,
     `resolveConfigUrl` in `packages/react/src/core/ingest-urls.ts`, built with `buildIngestUrl` —
     no hand-typed `/api`).
  3. **Captured native fetch.** `state.nativeFetch ??= (globalThis.fetch.__nexusOriginal ??
     globalThis.fetch)` is taken once — by `installNexusEarly` or the first tracker — BEFORE our
     patch. Ingest and config use only this reference, so a host interceptor (e.g. one adding
     `Authorization`) never touches our requests.
  4. **XHR patch** on `XMLHttpRequest.prototype` (`packages/react/src/core/xhr-patch.ts`), with
     fixed semantics: every wrapper is a `function` calling `original.apply(this, arguments)` and
     returning its result (2-argument `open` stays async); only the decoration is inside try/catch,
     so an exception of the original propagates exactly once and the original is never called
     twice; a WeakMap `xhr → {url, setNames}` is reset on every `open()`; `send` adds only the
     missing headers through the ORIGINAL `setRequestHeader`, each call guarded; the prototype is
     restored only if the methods are still ours (`{proto, original, patched}` is kept for that).
  5. **Live gating per call.** Every fetch and XHR wrapper checks `isPropagationAllowed(source)` on
     every call: false when the key scope is disabled, when the cached or remote config disables
     `header_propagation`, or when a local option is off — then the wrapper is a pure pass-through.
     The source is chosen PER REQUEST (`headerSourceFor(url)`): the newest live source that would
     decorate that url, so the early install's `propagateHeadersTo` keeps working after a tracker
     without one mounts.
     Entering the disabled state (`applyDisabled`, `packages/react/src/core/kill.ts`) also restores
     `window.fetch` and the XHR prototype if they are still ours, even for the early source.
  6. **Early entry `@nexus/react/early`** (`packages/react/src/early.ts`) exports exactly
     `installNexusEarly` and `NexusEarlyOptions`; `sideEffects: false` stays (an explicit call, no
     import side effect). It imports no React, no `browser-tracker`, no `registry`, no
     `remote-config` and no network code beyond URL helpers (a test walks its whole import graph).
     `publishableKey` is REQUIRED, so the early install has a key scope and can be killed.
     - **Next ≥ 15.3:** call it from `src/instrumentation-client.ts`
       (`docs/snippets/next-instrumentation-client.ts`).
     - **Vite / CRA:** ESM imports are hoisted, so a call in `main.tsx`'s body runs after the whole
       app graph — too late. Ship an app-local module (`docs/snippets/vite-nexus-early.ts`) and
       require `import './nexus-early';` as the FIRST import of `main.tsx`.
  7. **Bundle budget** of the early entry: **`dist/early.js` and `dist/early.cjs` ≤ 8 KiB as
     shipped**, and no BrowserTracker, React, registry or remote-config code. The spec said "8 KiB
     unminified"; the shipped file meets 8 KiB by MINIFYING this one entry (tsup `minify`, plus
     plain constructor assignments instead of the class-field helper) and by importing leaf
     constants (`SDK_BROWSER_SESSION_IDLE_MS`, `SDK_BROWSER_CONFIG_MAX_STALE_MS`,
     `SDK_BROWSER_XHR_PATCH`) instead of the whole `SDK_DEFAULTS` object. Measured 2026-11-19:
     8,108 B (`early.js`), 3.1 KB gzipped. `npm run sdk:pack` fails when a file goes over budget.
     *Pending owner OK:* reading the budget as "the shipped (minified) file" rather than
     "unminified source output".
  8. **One session store.** A single `SessionStore` over one `SafeStorage(sessionStorage)` lives in
     the v2 global state `Symbol.for('@nexus/react/state@2')`. `peekCurrent(now)` never rotates on an
     email change but DOES rotate on idle expiry (`sessionIdleMs`), persisting `{id, seq: 0,
     lastActivityAt: now}`; it does not touch `lastActivityAt` otherwise (background polling must not
     extend a session).
  9. **Page-view header:** the early install pre-allocates `pendingPageViewId`, which the tracker's
     first `'load'` page_view uses as its `eventId`. `X-Nexus-Page-View` = the active view's id (also
     after `view.ended`), else the pending id — sent ONLY when the view's `sessionId` equals the
     current session, so a rotated session is never paired with an old view. Because the pending id
     was already sent with the CURRENT session, the first `'load'` page_view that takes it is
     emitted with `SessionStore.nextEvent(email, now, keepForUnknownUser = true)`: an `undefined`
     user hint (auth not resolved on the first render) counts as "not known yet" and does not rotate
     a stored signed-in session — the page view lands in the session its early API calls carried.
- **Consequences:**
  - Apps that upgrade link most browser-originated API calls without code beyond the early file;
    the KPI is "Linked API calls" (ADR 0013).
  - A host that wraps `fetch` after us keeps working: we restore only what is still ours, and a
    killed tracker's wrappers are pass-throughs until then.
  - When a tracker starts with a cached kill, early patches installed earlier in that page stay as
    pass-throughs until a kill arrives in the page (safe for the host; restoring at start would reset
    the 15-minute recheck).
