import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@nexus/source'] },
  test: { include: ['src/**/*.test.ts'] },
});
