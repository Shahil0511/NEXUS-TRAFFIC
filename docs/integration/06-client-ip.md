# The client IP

Your server sees the **last proxy's** address as the socket peer — the gateway nginx or a Next.js
container — not the user. The user's IP is inside `X-Forwarded-For` (XFF), but **only some entries
of that header can be trusted**.

## Why the leftmost entry is wrong

Each proxy *appends* the address it received the request from:

```text
X-Forwarded-For: <whatever the client sent>, <added by proxy 1>, <added by proxy 2>
```

A client can send `X-Forwarded-For: 1.1.1.1` itself, and nginx happily keeps it at the front. The
leftmost value is therefore **attacker-controlled**. The only safe reading walks from the **right**,
skipping exactly the number of proxies **you** operate.

## The algorithm

```text
chain  = [ ...X-Forwarded-For entries (trimmed, empty ones removed), socket peer address ]
client = chain[ max(0, chain.length - 1 - trustProxyHops) ]
```

- `trustProxyHops` = how many proxies **you** run in front of the code that reads the header.
- Strip the IPv6 prefix `::ffff:` from IPv4 addresses (`::ffff:203.0.113.24` → `203.0.113.24`).
- Never index below 0: if the chain is shorter than expected, take its first entry.

| Your setup | `trustProxyHops` |
|---|---|
| Browser → gateway nginx → **your API** | **1** |
| Browser → gateway nginx → Next.js (rewrite / proxy) → **your API** | **2** |
| Browser → **your API** directly (local development) | 0 |

## Worked examples

The user's real address is `203.0.113.24`. The gateway reaches your container from `172.18.0.1`;
a Next.js container is `172.18.0.5`.

| Setup / request | XFF your code receives | Socket peer | hops | chain | Result |
|---|---|---|---|---|---|
| gateway → API | `203.0.113.24` | `172.18.0.1` | 1 | `[203.0.113.24, 172.18.0.1]` | **203.0.113.24** ✔ |
| …client forges XFF | `1.1.1.1, 203.0.113.24` | `172.18.0.1` | 1 | `[1.1.1.1, 203.0.113.24, 172.18.0.1]` | **203.0.113.24** ✔ (forgery ignored) |
| gateway → Next → API | `203.0.113.24, 172.18.0.1` | `172.18.0.5` | 2 | `[203.0.113.24, 172.18.0.1, 172.18.0.5]` | **203.0.113.24** ✔ |
| gateway → API, **hops too high (2)** + forged XFF | `1.1.1.1, 203.0.113.24` | `172.18.0.1` | 2 | `[1.1.1.1, 203.0.113.24, 172.18.0.1]` | **1.1.1.1** ✘ attacker wins |
| gateway → API, **hops too low (0)** | `203.0.113.24` | `172.18.0.1` | 0 | `[203.0.113.24, 172.18.0.1]` | **172.18.0.1** ✘ every user looks private |

Too high lets users fake their location; too low makes everyone look like your gateway. Count your
proxies.

## Code

JavaScript (the same function ships in every snippet):

```js
function resolveClientIp(xForwardedFor, remoteAddress, trustProxyHops) {
  const raw = Array.isArray(xForwardedFor) ? xForwardedFor.join(',') : xForwardedFor || '';
  const strip = (v) => (v.trim().toLowerCase().startsWith('::ffff:') && v.includes('.') ? v.trim().slice(7) : v.trim());
  const chain = raw.split(',').map(strip).filter(Boolean);
  if (remoteAddress) chain.push(strip(remoteAddress));
  if (chain.length === 0) return undefined;
  return chain[Math.max(0, chain.length - 1 - trustProxyHops)];
}

// Express: resolveClientIp(req.headers['x-forwarded-for'], req.socket.remoteAddress, 1)
```

Python (ASGI):

```python
def resolve_client_ip(x_forwarded_for, remote_address, trust_proxy_hops):
    chain = [p.strip() for p in (x_forwarded_for or "").split(",") if p.strip()]
    if remote_address:
        chain.append(remote_address)
    chain = [v[7:] if v.lower().startswith("::ffff:") and "." in v else v for v in chain]
    return chain[max(0, len(chain) - 1 - trust_proxy_hops)] if chain else None
```

**Express shortcut:** `app.set('trust proxy', 1)` (a **number**, never `true`) makes `req.ip` follow
the same rule. `true` trusts every hop — i.e. the forged leftmost entry.

## Our side

- Send the resolved address in the event's `ip` field. We use it **as given** — our own proxy
  settings (`TRUST_PROXY_HOPS` on the Nexus server) apply only to browser beacons, **never** to the
  `ip` you send.
- Invalid values are dropped with a `FIELD_DROPPED` warning; the event is still stored.
- If more than 90 % of your events carry private addresses (`10.x`, `172.16–31.x`, `192.168.x`,
  loopback), the Integration Health view flags *"set trustProxyHops"*.
