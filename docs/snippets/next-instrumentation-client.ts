/**
 * Data Nexus Traffic — early header install for a Next.js (≥ 15.3) App Router app.
 *
 * Save this file as `src/instrumentation-client.ts` (or `instrumentation-client.ts` next to `app/`
 * when you have no `src/`). Next runs it in the browser BEFORE your app hydrates, so even the
 * first API calls carry `X-Nexus-Session` / `X-Nexus-Page-View` and the backend SDK can link them
 * to the page view. `<NexusTracker/>` (docs/snippets/next-tracker.tsx) later adopts the same
 * session and page-view id.
 *
 * - Use the SAME build-time env vars as the tracker. Keep `process.env.NEXT_PUBLIC_*` literal:
 *   Next only inlines a literal property access.
 * - The publishable key is REQUIRED (the kill switch is per key). Unset → a silent no-op.
 * - Only same-origin calls are decorated. For an API on another origin, add
 *   `propagateHeadersTo: ['https://api.example.com']` AND allow `X-Nexus-Session` /
 *   `X-Nexus-Page-View` in that API's CORS `allowedHeaders`, or the browser blocks the call.
 */
import { installNexusEarly } from '@nexus/react/early';

installNexusEarly({
  url: process.env.NEXT_PUBLIC_NEXUS_URL,
  publishableKey: process.env.NEXT_PUBLIC_NEXUS_KEY,
});
