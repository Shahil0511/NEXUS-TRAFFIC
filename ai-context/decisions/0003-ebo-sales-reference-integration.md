# ADR 0003 — EBO_SALES is integrated by us (the one exception to "never touch D:\server")

- **Status:** accepted (2026-10-05); implemented 2026-10-05 (see [PROGRESS.md](../PROGRESS.md)).
- **Context:** the hard rule (CLAUDE.md, [01-project-overview.md](../01-project-overview.md)) says Nexus
  Traffic never edits the apps in `D:\server` — other teams own them and wire in the snippets
  themselves. On 2026-10-05 the user explained that **EBO_SALES is their own project** and explicitly
  allowed changes in `D:\server\EBO_SALES` so it is integrated with Nexus Traffic, with monitoring
  **ON by default in production, OFF in development**, and a switch to turn it on in development.
- **Decision:**
  1. `D:\server\EBO_SALES` may be edited **for the Nexus Traffic integration**. Every other folder in
     `D:\server` (AgreementVault, EBO_STOCK_AUDIT, finance-tool, Finance_recon, stockapp) stays
     read-only; the hard rule is unchanged for them.
  2. EBO_SALES consumes Nexus exactly like any other team would — the public guide's artefacts,
     copied verbatim: `docs/snippets/fastapi_nexus_asgi.py` (vendored as
     `backend/app/core/nexus_asgi.py`) and the `@nexus/react` tarball from `npm run sdk:pack`
     (vendored as `frontend/vendor/nexus-react-1.0.0.tgz`). Fixes go into the Nexus snippet/SDK first,
     then are copied — so EBO_SALES doubles as the **reference integration** that proves the guide.
  3. Two separate switches, both defaulting to "ON only in production": `NEXUS_ENABLED` (backend,
     keyed off EBO's `ENV=production`) and `NEXT_PUBLIC_NEXUS_ENABLED` (frontend, keyed off
     `NODE_ENV=production`, i.e. `next build`). Nothing is sent without a URL and a key.
  4. Development points at the **local** Nexus (`http://localhost:4000`, app `ebo-sales-dev`,
     no base path, origins `http://localhost:3000`–`3002`). Production uses app `ebo-sales`
     (base path `/ebo-sales`) on `https://nexus.libas.in/traffic`. The cut-over steps live in
     EBO_SALES's own guide, `D:\server\EBO_SALES\docs\NEXUS_TRAFFIC.md`.
  5. Changes in EBO_SALES are left uncommitted for the user to review (their repo, their history).
- **Consequences:**
  - Integrating EBO_SALES surfaced a snippet bug other FastAPI teams would hit: FastAPI 0.13x+
    exposes only the router-relative route path on `scope["route"]`, so route templates lost their
    `/api/v1` prefix. Fixed in `docs/snippets/fastapi_nexus_asgi.py` (`_restore_router_prefix`), plus a
    `mypy --strict` fix (lambda narrowing of `get_user` / `get_error_code`).
  - A future session must not "fix" EBO_SALES edits as a rule violation, and must not extend this
    exception to other `D:\server` apps without a new ADR.
