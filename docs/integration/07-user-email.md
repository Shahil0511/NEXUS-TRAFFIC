# The user's email

Knowing **who** made a request is the most useful thing you can send — and the easiest to get wrong.
Send the identity your app has **verified**, never something a client could have written.

## Identity levels

Every event ends up with one of four identity levels, strongest first:

| Level | How it is set | Counts as a known user? |
|---|---|---|
| `sso_cookie` | **we** verified the portal's `access_token` cookie on a browser beacon | yes |
| `app_attested` | **your backend** sent `userEmail`, authenticated by your secret key | yes |
| `client_claimed` | the browser sent `user.email` (publishable key — anyone could) | **no** — shown as *claimed* |
| `anonymous` | nothing | no |

Only `sso_cookie` and `app_attested` fill the user columns of the dashboard. That is why the server
event's `userEmail` matters: it is the identity we trust from you.

## What to send in `userEmail`

- The email of the user **your auth layer verified** for this request: the session user, the subject
  of a JWT **whose signature you checked**, the user your SSO middleware attached to `req`.
- Read it **when the response finishes**, not when the request arrives — your auth middleware may run
  after ours. The snippets call `getUser(req)` at `finish` for exactly this reason.
- Lower-case and trimmed is ideal; ≤ 254 characters. A value that does not look like an email is
  dropped with a `FIELD_DROPPED` warning.
- **Omit** it for anonymous requests, health checks and machine-to-machine calls. Do not send
  placeholders like `unknown` or `system`.

## What NOT to send

- A JWT payload you **decoded without verifying** the signature — anyone can forge one.
- A request header such as `X-User-Email` / `X-Nexus-User` that the **client** can set.
- A hard-coded developer email used as a local fallback (`if (!user) user = 'me@libas.in'`) — make sure
  that code path cannot run in production, or you attribute every anonymous call to one person.

## The `X-Nexus-User` header — only behind a gateway that owns it

Some setups resolve identity at the gateway and forward it in a header. The reference SDK package
(`@nexus/express`, coming) reads `X-Nexus-User` **only when you opt in with
`trustIdentityHeader: true`**; with the snippets you would write `getUser: (req) => req.get('x-nexus-user')`
yourself. Either way, do it only when:

1. every request reaches your app **through** that gateway (the app port is not reachable directly —
   a published Docker port such as `0.0.0.0:3001` breaks this), **and**
2. the gateway **overwrites** the header on every request (`proxy_set_header X-Nexus-User $user;`),
   so a value sent by the client never survives.

If either is not true, leave it off: a forged header would put any email into your data.

## Browser hint (`user.email`)

The browser tracker may send `user.email` as a **hint**. It is stored as `client_claimed` and never
counted as identified. For apps on `nexus.libas.in` you rarely need it: the SSO cookie travels with
the beacon and we verify it ourselves (`sso_cookie`).
