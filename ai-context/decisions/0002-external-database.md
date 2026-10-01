# ADR 0002 — Use a dedicated database on the shared Postgres server

- **Status:** accepted (2026-10-01)
- **Context:** the user asked to store Nexus Traffic data on the company Postgres server
  (10.150.0.5, PostgreSQL 18.1 on Windows, TimescaleDB installed) instead of a Postgres container,
  without touching any other app's tables (Unicorn, agreementvault, audit…).
  A read-only inspection showed the provided login (`shahil`) has **no CREATE privilege on the
  Unicorn database or its `public` schema**, **no CREATEROLE**, but **CREATEDB**. AgreementVault already
  follows the "own database on the shared server" pattern (`agreementvault` database).
- **Decision:**
  1. Nexus Traffic lives in its own database **`nexus_traffic`** on 10.150.0.5 (created 2026-10-01,
     owner `shahil`, UTF8). Inside it, everything stays in schema `traffic`. No other database is
     ever connected to or modified.
  2. Because the login cannot create roles, the runtime role split becomes **optional**:
     `DB_APP_ROLE_MODE=owner` (production on the shared server) → the api connects with the same
     login as migrations; `DB_APP_ROLE_MODE=separate` (local Docker Postgres) → the bootstrap creates
     `nexus_app` with DML-only grants as originally designed.
  3. The `postgres` compose service becomes optional (profile `localdb`) for local development and
     tests; production `DATABASE_URL` / `MIGRATION_DATABASE_URL` point at 10.150.0.5/nexus_traffic.
  4. Server major version is **18** → local Postgres image and the `pg_dump` client used for backups
     must be `postgres:18-alpine` (pg_dump must be ≥ the server version).
  5. Credentials live ONLY in the git-ignored `.env` on the deploy host (password URL-encoded in the
     connection strings: `@` → `%40`). They are never committed or written into docs.
- **Consequences:**
  - In owner mode an injection bug could run DDL on *our* database only (not on Unicorn or others,
    since the login has no rights there). Raw SQL stays parameterised; partition DDL still goes
    through the whitelisted functions.
  - The TL's server must reach 10.150.0.5:5432 from Docker containers (same as the other apps).
  - Backups: the shared server may already be backed up by its owners; `pg-backup` remains available
    for a Nexus-only dump.
