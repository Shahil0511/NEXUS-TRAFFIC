# ADR 0012 — Browser retry queue and replay identity

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
- **Context:** the 1.0.0 tracker sent everything with `sendBeacon`, which reports only "queued", so
  a `429`, a `503` during a deploy or a flaky office network silently lost events. Keeping failed
  batches across page loads is the obvious fix, but it must not loop poison batches, blow the host
  app's storage quota, replay a killed key, or attribute an old batch to whoever is signed in now.
- **Decision:**
  1. **In-page sends** use the CAPTURED native fetch (ADR 0011) with `{method:'POST', keepalive:true,
     credentials:'include', body: text/plain}`, so the status is readable; one batch in flight at a
     time (the 64 KiB keepalive budget) — `BatchSender` (`packages/react/src/core/batch-sender.ts`).
     **Unload** (`hidden` / `pagehide`) uses `sendBeacon`; `true` counts as delivered (no duplicate
     inflation). No fetch, or a synchronous throw → beacon. A live request with no answer after
     `SDK_DEFAULTS.browser.ingestTimeoutMs` (15 s) is aborted and counts as `retry_opaque`, and at
     most `maxPendingBatches` (10) batches wait in memory — beyond that the oldest waiting one is
     handed to the persistent queue (or counted in `droppedOverflow`), so a blackholed collector
     never grows memory nor a burst of unload beacons. On unload, the batch IN FLIGHT is persisted
     too when it already failed once (its retry may never settle once the document is gone).
  2. **Outcomes** (`classifyDelivery(status, code)` in `packages/react/src/core/transport.ts`):
     `2xx` delivered; `400`, `413`, `415`, `403 ORIGIN_NOT_ALLOWED` drop; `401`/`403` with
     `SDK_KILL_ERROR_CODES` disabled (drop the batch, PURGE the key scope's persisted queue,
     `applyDisabled()`); `429`, `5xx` in-page back-off per `SDK_DEFAULTS.retry`, then persist; network
     error / TypeError / opaque response back off and persist at most ONCE per batch; a `401`/`403`
     with an unknown code is a drop.
  3. **Persistence only after a failed attempt**, in localStorage key
     `${STORAGE_KEYS.retryQueue}:${keyScope}` (`keyScope` = the trimmed key's first 14 chars — several
     apps share the `nexus.libas.in` origin, and only the public prefix is used).
  4. **Its own `RetryStorage`** (`packages/react/src/core/retry-storage.ts`), not `SafeStorage`: it
     always tries the real localStorage; a quota or other error on write DROPS that persist and
     counts `persistFailed`. It never falls back to memory, so `remove()` always reaches real storage.
  5. **Bounds** (`SDK_DEFAULTS.browser`): `retryQueueMaxBatches` 20, `retryQueueMaxBytes` 128 KiB per
     key scope (oldest dropped; small because host apps share the origin quota), `retryQueueTtlMs`
     24 h on the batch's oldest `occurredAt` (a shared contract test keeps it below half the 7-day
     backdate window), `retryQueueMaxReplays` 3 page loads without delivery.
  6. **Persisted entry** `{envelope, attempts, replays}`: the envelope keeps `eventId`, `occurredAt`,
     `sessionId` and `seq` VERBATIM (the server de-duplicates), is stored WITHOUT `user`, and gets
     `sentAt` re-stamped on each send.
  7. **Replay** on the next load with `client.replay: true` (new optional wire field), after the
     startup config refresh settled (so a kill purges before anything is replayed). The server
     SKIPS the SSO cookie for replays (the cookie may belong to a later user) — the rows are stored
     anonymous — and records no SSO outcome. Multi-tab: `navigator.locks.request(name,
     {ifAvailable:true})`, else a claim record `{owner, at}` that goes stale after 60 s. An entry is
     forgotten when an in-page retry later succeeds.
  8. **Other scopes' leftovers:** on start each tracker removes OTHER key scopes' retry queues whose
     newest batch is past the TTL, their stale claim records, and config caches older than
     `configMaxStaleMs` (`pruneStaleScopes`, `packages/react/src/core/stale-scopes.ts`), so a rotated
     key never keeps its 128 KiB in the shared origin quota.
  9. **Counters stay SDK-local** (`getNexusStats()`: queued, droppedOverflow, persisted,
     persistFailed, replayed, expired, droppedReplayCap, configVersion, disabled). Reporting them on
     the wire is future work.
- **Consequences:**
  - Short outages and deploys no longer lose browser events; anything older than 24 h or replayed
    3 times is gone by design.
  - Replayed events count as anonymous even when the user was signed in — the identity KPI is a
    little lower for apps with many replays, never wrong.
  - `persistRetries: false` and the remote module switch `retry_queue` turn the queue off.
