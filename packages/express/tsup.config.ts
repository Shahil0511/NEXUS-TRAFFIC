import { defineConfig } from 'tsup';

/**
 * WHY: one self-contained dual CJS+ESM bundle. @nexus/shared and @nexus/node are BUNDLED (noExternal) and read from
 * source through the `@nexus/source` condition, so the published package.json has NO dependencies.
 * Only zod-free shared subpaths are imported — scripts/sdk-pack.ts asserts zod never lands here.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: { resolve: [/^@nexus\//] },
  sourcemap: true,
  clean: true,
  target: 'node18',
  platform: 'node',
  noExternal: [/^@nexus\//],
  esbuildOptions(options) {
    options.conditions = ['@nexus/source'];
  },
});
