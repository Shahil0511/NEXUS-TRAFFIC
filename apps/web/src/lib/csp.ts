/**
 * The dashboard's Content-Security-Policy and its per-request nonce.
 *
 * WHY A MODULE: src/proxy.ts sets the policy and the `x-nonce` request header; the root layout
 * reads that header (src/app/layout.tsx). Both import the names from here, so neither side
 * hand-types a header and the layout never imports the proxy (and its JWT code).
 */

/** Request header carrying the nonce to the render (Next 16 CSP guide). */
export const NONCE_HEADER = 'x-nonce';
export const CSP_HEADER = 'Content-Security-Policy';

/** A fresh, unguessable nonce per request. */
export function createNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString('base64');
}

/**
 * The policy. Scripts: only nonce-bearing ones and what they load ('strict-dynamic').
 * Styles allow inline attributes because React/recharts/radix render `style="…"` (CSS cannot
 * execute script). 'unsafe-eval' ONLY in development (React's debugging needs it).
 * connect-src 'self' also covers the live socket: it is same-origin (`/traffic/socket.io`,
 * src/lib/socket.ts) and CSP Level 3 matches 'self' for ws:/wss: on the same host.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
