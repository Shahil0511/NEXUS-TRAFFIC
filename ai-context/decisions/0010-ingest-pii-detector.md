# ADR 0010 — Ingest-time PII detector (scrub, never reject; two passes)

- **Status:** accepted (2026-11-18); implemented 2026-11-19 (Phase A, see [PROGRESS.md](../PROGRESS.md)).
- **Context:** the contract has free-text fields (path, labels, props, tool names, error codes,
  request ids, release). The guide asks teams to keep personal data out of them, but Indian retail
  URLs routinely carry mobile numbers, and labels or props can carry PAN, GSTIN or Aadhaar numbers.
  Raw paths are stored for 6 months. We need a safety net that never breaks ingest.
- **Decision:**
  1. **Scrub, never reject.** A detection replaces the match (or drops the field) and the event is
     stored; the sender gets a `FIELD_REDACTED` warning `{index, code, field}` (wire field name), and
     we count `(app, source, field, kind, hour)` in `traffic.pii_detections`
     (`apps/api/migrations/0011_pii_detections.sql`). The matched value is never stored, returned or
     logged. One detection is counted per (event, field, kind), across both passes
     (`PiiFindings`, `apps/api/src/enrichment/pii-findings.ts`); only **inserted** rows are counted
     (not duplicates, not poison rows).
  2. **Where:** API enrichment only, in `PiiScrubber` (`apps/api/src/enrichment/pii.scrubber.ts`),
     called by both enrichers — NEVER a zod `.transform()` (the schemas stay pure and shared with the
     SDKs). Patterns are strings in `packages/shared/src/constants/pii.ts`, compiled once with `gi`,
     run in the order email → gstin → pan → aadhaar → phone; GSTIN (mod-36) and Aadhaar (Verhoeff)
     matches are post-filtered by their checksums. `isVerhoeffValid` ignores spaces, `-` and `%20`.
  3. **Kinds** `PII_KIND_VALUES` = email, phone, pan, gstin, aadhaar. **Fields** `PII_FIELD_VALUES` =
     path, route_template, referrer_path, label, prop_key, prop_value, tool, name, error_code,
     request_id, release. `userEmail` / `user.email` are excluded — they are intended.
  4. **Pass 1, BEFORE** `RouteNormalizer` / `toEndpointId` / `toToolId`, so ids are computed on
     scrubbed text. Path-like fields use STRICT patterns (phone needs `+91`/`%2B91`, Aadhaar needs
     separators), so numeric ids do not split; text fields use looser ones (bare 10-digit mobiles,
     unseparated Aadhaar). Both phone patterns accept the Indian `XXXXX XXXXX` grouping with one
     space or `-` (`98765 43210`, `+91-98765-43210`); the text one also a bare `91` country code
     (`919876543210`, as in wa.me links). The OPAQUE identifiers `request_id` and `release` use the
     STRICT patterns (`PiiScrubber.scrubOpaqueId`): about 1 % of random 32-hex request ids contain a
     10-digit run starting 6–9, which the loose rule flagged as a mobile — that dropped real ids and
     kept `pii_detected` (a blocking warning) on for apps that send nginx / UUID request ids.
     `error_code` stays on the text patterns.
  5. **Pass 2, AFTER** the ids, on the STORED `path` / `referrer_path` only: a whole `/` segment that
     is exactly `(91)?[6-9]\d{9}` becomes `:phone`, a Verhoeff-valid 12-digit run `:aadhaar`
     (`PII_SEGMENT_PATTERN_SOURCES`). The template already reads `:num` there, so grouping is
     unaffected.
  6. **Replacement policy:** path, route_template, referrer_path, label, prop_value → the token of
     the kind (`PII_REDACTION_TOKENS`: `:email`, `:phone`, `:pan`, `:gstin`, `:aadhaar`; each token is
     ≤ `PII_MIN_MATCH_LENGTH[kind]`, so a length CHECK can never break); tool, name →
     `PII_IDENTIFIER_REDACTION = 'redacted'` (keeps `TOOL_NAME_PATTERN` valid); prop_key → drop the
     prop (props becomes absent when none is left); error_code, request_id, release → drop the field.
     A PII hit in the browser envelope `release` drops it for the batch, warned once and counted per
     stored row.
  7. **Only STRING prop values are scanned.** A number (`{mobile: 9876543210}`) is stored as is: it
     keeps counts such as 10-digit totals free of false positives. The guide tells senders never to
     send phone or Aadhaar numbers as numbers. *Open for the owner:* scanning `String(value)` of
     numbers would close this gap at the cost of false positives on large counts; if chosen, it is a
     follow-up ADR.
  8. **Integration Health** shows the counts (`PiiDetectionDto`) and the warning `pii_detected`,
     inserted right after `exposed_key`; it blocks the `complete` integration level (ADR 0013).
- **Consequences:**
  - **Accepted cost:** a 10-digit order id starting 6–9 that is a whole path segment is replaced by
    `:phone` in the raw path. The bare-mobile URL is the most common leak, and raw paths are kept
    for 6 months; ids and grouping are unaffected.
  - Accepted false positives: retina asset names such as `logo@2x.png` match the email pattern
    (the tracker's skip-extensions list stops most asset paths first), and PAN can match a few
    word+number segments (e.g. `bills2024q`).
  - The detector is a net, not a licence: names, addresses and typed text are not detectable, so the
    "NEVER send" list of guide chapter 05 still applies.
