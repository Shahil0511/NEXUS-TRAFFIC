/**
 * Unit tests of the dev tooling: `npx vitest run --root scripts/dev`.
 * `@nexus/source` resolves @nexus/shared / @nexus/auth to their TypeScript sources (no build needed).
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@nexus/source'] },
  test: { include: ['*.test.ts'] },
});
