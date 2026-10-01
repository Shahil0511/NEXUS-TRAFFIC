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
`routeTemplate` (`/users/:email/orders`) as `path` too. We normalise emails in paths for grouping,
but the raw path is still stored — keep it clean at the source.

## What we do on our side

- **IP addresses** are stored in full by default (they are needed for location and were explicitly
  requested); geo-location is resolved from the full IP. The platform can switch to truncated or
  hashed storage. IPs are visible to **dashboard admins only**.
- **Emails** are shown only to signed-in Libas staff allowed to use the dashboard, and are **masked
  in our logs** (`s***@libas.in`). Dashboard URLs use an opaque user key, never an email.
- **Query strings** are removed from paths even if you send them; bodies are never accepted.
- **Retention:** raw events are kept for **6 months**, then deleted month by month.
- The dashboard is behind the company SSO. The ingest API only accepts writes.
