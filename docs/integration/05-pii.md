# Personal data (PII)

We collect the minimum needed to answer "who used what, how well did it work, and from where".
The contract only has fields for that — anything else you send is ignored — but some fields (path,
label, props) are free text, so **you** must keep personal data out of them.

## DO send

| Data | Field | Why |
|---|---|---|
| HTTP method, status, duration, sizes | `method`, `status`, `durationMs`, `*Bytes` | performance and errors |
| Path **without** query string | `path` | which page / endpoint |
| Route pattern | `routeTemplate` | groups `/stores/1042` and `/stores/7` as one endpoint |
| End-user IP (through trusted proxies) | `ip` | location (country / city) and abuse analysis |
| The **verified** signed-in user's email | `userEmail` (server) | who uses what — see [chapter 7](07-user-email.md) |
| Your request id | `requestId` | correlate with your own logs |
| User agent | `userAgent` | browser / OS / device breakdown |
| Your error **code** | `errorCode` | e.g. `VALIDATION_ERROR` |
| Static UI identifiers | `tool`, `name`, `label` | which features are used |

## NEVER send

- request or response **bodies**, form values, file contents;
- **headers** or **cookies** (other than the user agent), including `Authorization`;
- **tokens, passwords, API keys, session ids** of your own app — in any field;
- **query strings** (`?email=…&token=…`) — strip everything after `?` (and `#`) from `path`;
- **text the user typed**: search terms, comments, names, addresses — never in `label` or `props`;
- **phone numbers, PAN, GST, Aadhaar, bank details**, customer names;
- **cost, price or margin data** in `props` or `value`;
- error **messages** or stack traces (they often contain data) — send an `errorCode` instead;
- **the secret key in browser code** (it is refused and flagged).

## Paths that contain personal data

If your URLs put personal data **in the path itself** (`/users/someone@libas.in/orders`,
`/customers/9876543210`), send a sanitised path: replace the segment before sending, e.g. send the
`routeTemplate` (`/users/:email/orders`) as `path` too. Our detector (below) catches the common
cases, but it is a safety net — keep the data out at the source.

## The PII detector (what we redact for you)

Every event is checked at ingest for {{PII_KINDS}}. A detection **never rejects** the event: the
match is replaced (or the field removed), the event is stored, and the answer carries a
`FIELD_REDACTED` warning naming the field. We count detections per field and kind (never the value)
and show them on the Integration page (warning **personal data detected**).

| Field | What happens to a match |
|---|---|
| `path`, `routeTemplate`, `referrerPath`, `label`, string `props` values | the match is replaced by a token: `:email`, `:phone`, `:pan`, `:gstin`, `:aadhaar` |
| `tool`, `name` | the match is replaced by `redacted` (so the id stays valid) |
| a `props` **key** | that prop is removed |
| `errorCode`, `requestId`, `release` | the field is removed |

It runs in **two passes**:

1. **Before** we compute endpoint and page ids, on the text you sent. In paths the patterns are
   strict, so ordinary ids survive: a phone number needs `+91` (or `%2B91`), an Aadhaar number needs
   separators (`1234 5678 9012`), GSTIN and Aadhaar must pass their checksums. In free text
   (labels, props, tool names) the patterns are looser: a bare 10-digit mobile number or a 12-digit
   Aadhaar number is found too.
2. **After** the ids, on the **stored** `path` and `referrerPath` only: a whole path segment that is
   exactly a mobile number (10 digits starting 6–9) becomes `:phone`, and one that is a
   checksum-valid 12-digit Aadhaar number becomes `:aadhaar`. Grouping is not affected (the route
   template already reads `:num` there).

Known trade-offs:

- A 10-digit **order id that starts with 6–9** in a path segment is replaced by `:phone` in the raw
  path. Bare mobile numbers in URLs are the most common leak we see, and raw paths are kept for 6
  months, so we accept that cost. The route template and the endpoint / page grouping stay intact.
- Asset-like names such as `logo@2x.png` look like an email and are redacted.
- **Numbers are not checked**: only string values of `props` are scanned. Never send a phone or
  Aadhaar number as a number (`{ "mobile": 9876543210 }`) — it would be stored as is.
- The detector does not make the "NEVER send" list above optional. It cannot see names, addresses
  or anything typed into a free-text field.

## What we do on our side

- **IP addresses** are stored in full by default (they are needed for location and were explicitly
  requested); geo-location is resolved from the full IP. The platform can switch to truncated or
  hashed storage. IPs are visible to **dashboard admins only**.
- **Emails** are shown only to signed-in Libas staff allowed to use the dashboard, and are **masked
  in our logs** (`s***@libas.in`). Dashboard URLs use an opaque user key, never an email.
- **One person's activity** (their person page, or a visit / failure list narrowed to them) can be
  opened by **dashboard admins only**, and every such open is recorded in an append-only access
  log that names the person by a masked email only.
- **Query strings** are removed from paths even if you send them; bodies are never accepted.
- **Retention:** raw events are kept for **6 months**, then deleted month by month. The hourly
  diagnostic counts (PII detections, rejection reasons, SSO cookie outcomes) are kept for
  **{{AGGREGATE_RETENTION_DAYS}} days**; they hold codes, field names and numbers only.
- The dashboard is behind the company SSO. The ingest API only accepts writes.
