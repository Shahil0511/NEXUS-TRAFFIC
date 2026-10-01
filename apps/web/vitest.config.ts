/**
 * Unit + component tests of the dashboard (vitest + Testing Library + MSW).
 *
 * WHY THESE SETTINGS
 * - `@nexus/source` first: shared/auth resolve to their TypeScript sources, exactly like the editor
 *   (tsconfig customConditions), so tests never run against a stale `dist`.
 * - jsdom at the real public URL (`/traffic/…`): `request()` builds same-origin relative URLs and
 *   MSW resolves them against `location`, the way the browser does.
 * - esbuild `jsx: 'automatic'`: React 19 JSX without a Vite React plugin.
 * - src/proxy.test.ts opts into the node environment with a docblock (NextRequest + node:crypto).
 */
import path from 'node:path';

import { defaultClientConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['@nexus/source', ...defaultClientConditions],
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:3305/traffic/' } },
    setupFiles: ['./src/test/setup.ts'],
  },
});
