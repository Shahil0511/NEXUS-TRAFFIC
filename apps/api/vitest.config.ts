import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@nexus/source'] },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // DB suites (*.integration.test.ts) self-skip unless RUN_DB_TESTS=1.
    fileParallelism: false,
  },
});
