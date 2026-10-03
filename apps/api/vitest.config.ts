import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Tests run in Vite's SSR environment, whose conditions are `ssr.resolve.conditions` (top-level
  // `resolve.conditions` only reach the client environment): `@nexus/source` first, so
  // @nexus/shared and @nexus/auth resolve to their TypeScript sources, never to a stale `dist`.
  resolve: { conditions: ['@nexus/source'] },
  ssr: { resolve: { conditions: ['@nexus/source', ...defaultServerConditions] } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // DB suites (*.integration.test.ts) self-skip unless RUN_DB_TESTS=1.
    fileParallelism: false,
  },
});
