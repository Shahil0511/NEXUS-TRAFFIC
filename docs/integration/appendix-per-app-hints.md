# Appendix — per-app hints

> **Your team owns these changes; Nexus will not modify your repo.** The hints below come from a
> read-only look at each codebase and are **informational only**. Files are named by path and
> function/block, not line numbers — your code moves; check before you paste. If a hint no longer
> matches your code, your judgement wins (and please tell {{DOCS_CONTACT}} so we update it).

Common settings: `NEXUS_URL={{PUBLIC_URL}}` and `NEXUS_SECRET_KEY` in the backend environment;
the publishable key in the frontend build (chapter 9).

## AgreementVault

| | Hint |
|---|---|
| Backend stack | Express 4, TypeScript compiled to CommonJS → [express-esm.ts](files/snippets/express-esm.ts) (tsc emits CJS) |
| Mount point | `apps/api/src/app.ts` — directly after `app.use(requestLogger)`, before `app.use('/api', …)` |
| User | `getUser: (req) => req.currentUser?.email \|\| undefined` — read at response end (`authContext` runs later at router level); an empty string means unknown |
| Base path | the gateway strips `/ai-agreement`, so `basePath: '/ai-agreement'` |
| Proxies | gateway → api: `trustProxyHops: 1` |
| Watch out | a hard-coded developer fallback user outside production — make sure it never runs in production |
| Frontend | Next.js 14 — `apps/web/src/components/Providers.tsx`, inside the `AppContext` provider (mounts after `/api/me`); user hint: `useApp().me.user.email` |

## EBO_SALES

**Integrated** (reference integration, 2026-10-05) — its repo's `docs/NEXUS_TRAFFIC.md` describes the
switches and keys. The hints below are what it follows.

| | Hint |
|---|---|
| Backend stack | FastAPI, Python 3.12 → [fastapi_nexus_asgi.py](files/snippets/fastapi_nexus_asgi.py) |
| Mount point | `backend/app/main.py` — add `NexusASGIMiddleware` **before** the line that registers `request_context_middleware` (Starlette: last added = outermost), so Nexus runs inside it and still sees its context variables |
| User | `get_user=lambda scope: user_email_ctx.get()` (from `core/context.py`; already normalised) |
| Base path | set `base_path` so that `path` equals the public path, e.g. `"/ebo-sales"` if FastAPI sees `/api/v1/…` |
| Proxies | gateway → Next.js (`proxy.ts` rewrite) → api: `trust_proxy_hops=2` (uvicorn runs without `--proxy-headers`) |
| Request id | `X-Request-ID` is picked up automatically if your middleware sets it on the request |
| Frontend | Next.js 16 — `frontend/src/app/providers.tsx` inside `Providers` (own `<Suspense>` if it reads search params); no client-side email (httpOnly cookie) — the SSO cookie identifies users |

## EBO_STOCK_AUDIT

| | Hint |
|---|---|
| Backend stack | Express 4, TypeScript **ESM** (`.js` import specifiers) → [express-esm.ts](files/snippets/express-esm.ts) |
| Mount point | `backend/src/app.ts` — directly after `app.use(authMiddleware)` |
| User | `getUser: (req) => emailFrom(req)` from `middleware/actor.ts` (not `req.user`, which is untyped) |
| Proxies | gateway → api: `trustProxyHops: 1` |
| Skip | `/api/health` is skipped by the default `skip` |
| Frontend | Next.js 14 — `frontend/src/components/providers/AppProviders.tsx` inside `QueryProvider` (**not** `layout.tsx`); user hint: `useCurrentUser().user?.email` |

## finance-tool

| | Hint |
|---|---|
| Backend stack | Express 4, **plain JavaScript CommonJS** → [express-cjs.js](files/snippets/express-cjs.js) |
| Mount point | `backend/server.js` — in the `// ─── Observability ───` block, after `app.use(attachRequestSignal)`; `require` it like the neighbouring middlewares |
| User | no authentication by design → events are anonymous; do **not** read identity headers unless a gateway owns them (chapter 7) |
| Proxies | `trust proxy` is already configured from `TRUST_PROXY`; use the same number: `trustProxyHops: 1` |
| Base path | routes are mounted both with and without `/finance-gst-tracker`; `basePath: '/finance-gst-tracker'` is safe — the snippet never doubles a prefix the path already has |
| Skip | the server also serves the SPA's static files — the default `skip` drops asset requests |
| Frontend | Vite 5 + React 18 SPA (base `/finance-gst-tracker/`) — `frontend/src/App.jsx`, next to the `initTheme` effect, with `useLocation()` from react-router; `VITE_NEXUS_URL` / `VITE_NEXUS_KEY` |

## Finance_recon

| | Hint |
|---|---|
| Backend stack | **Express 5**, TypeScript NodeNext → [express-esm.ts](files/snippets/express-esm.ts) |
| Mount point | `backend/api/src/app.ts` — directly after `correlationIdMiddleware` (next to `simpleRequestLogger`) and **before** `rateLimiterMiddleware`, so rate-limited 429s are recorded too |
| Path | the BASE_PATH strip rewrites `req.url`, so the path MUST come from `req.originalUrl.split('?')[0]` — the snippets already do this |
| Request id | the snippet reads `X-Request-ID`; to use `req.correlationId` instead, change that one line in `buildEvent` |
| User | no user on `req` today → anonymous until you attach a verified email |
| Proxies | gateway → api: `trustProxyHops: 1`; routes are mounted at `/` and `/api` |
| Express 5 | `req.query` is read-only — the snippet never touches it |
| Frontend | Next.js 16 — `frontend/app/layout.tsx`: a `'use client'` tracker component inside `<ThemeProvider>`, next to `QueryProvider` |

## stockapp

| | Hint |
|---|---|
| Backend stack | **NestJS 11** (platform-express) → [nestjs.main.ts](files/snippets/nestjs.main.ts) + [express-esm.ts](files/snippets/express-esm.ts) |
| Mount point | `backend/src/main.ts` — `app.use(nexusMiddleware(…))` right after `NestFactory.create`, **before** `setGlobalPrefix` |
| User | `(req as Request & { storeScope?: { email?: string } }).storeScope?.email` — set by the store-scope interceptor, readable at response end |
| Proxies | gateway → Next.js rewrite → api: `trustProxyHops: 2` |
| Watch out | the api port is **published** and trusts identity headers from anyone — never use `X-Nexus-User` / `trustIdentityHeader` here (chapter 7) |
| Frontend | Next.js 16 — `frontend/components/layout/app-shell.tsx`, next to `useAccessScope()` (never remounts); no client-side email |
