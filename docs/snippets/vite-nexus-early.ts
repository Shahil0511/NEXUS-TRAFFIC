/**
 * Data Nexus Traffic — early header install for a Vite (or CRA) React app.
 *
 * Save this file as `src/nexus-early.ts` and make it the FIRST import of `src/main.tsx`:
 *
 *      import './nexus-early';
 *      import { StrictMode } from 'react';
 *      …
 *
 * WHY a separate module: ES imports are hoisted, so a call written in main.tsx's body runs only
 * AFTER every imported module — including the API client that may already have sent requests.
 * A module imported first runs first. The tracker (docs/snippets/vite-react-tracker.tsx) later
 * adopts the same session and page-view id.
 *
 * - Use the SAME build-time env vars as the tracker (Vite inlines VITE_* at `vite build`).
 * - The publishable key is REQUIRED (the kill switch is per key). Unset → a silent no-op.
 * - Only same-origin calls are decorated (fetch and XMLHttpRequest/axios). For an API on another
 *   origin, add `propagateHeadersTo: ['https://api.example.com']` AND allow `X-Nexus-Session` /
 *   `X-Nexus-Page-View` in that API's CORS `allowedHeaders`.
 */
import { installNexusEarly } from '@nexus/react/early';

installNexusEarly({ url: import.meta.env.VITE_NEXUS_URL, publishableKey: import.meta.env.VITE_NEXUS_KEY });
