import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@nexus/source'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
