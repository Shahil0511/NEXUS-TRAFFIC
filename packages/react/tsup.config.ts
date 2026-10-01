/**
 * WHY: one build for both entries. `@nexus/shared` is BUNDLED (noExternal) so the published
 * package has an EMPTY `dependencies`; only zod-free subpaths of shared are imported, so zod never
 * lands in a browser bundle. `react` / `next` stay external (peer dependencies).
 *
 * The `next` entry is built separately; tsup keeps its top-level `'use client'` directive (verified
 * in dist/next.js). Both entries share tracker state through a globalThis registry, so the
 * core being bundled twice (and the CJS/ESM dual-package case) is harmless.
 */
import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['cjs', 'esm'],
  // Inline @nexus/shared types so the published .d.ts never imports a package consumers lack.
  dts: { resolve: [/^@nexus\//] },
  sourcemap: true,
  target: 'es2020',
  platform: 'browser',
  external: ['react', 'react/jsx-runtime', 'next', 'next/navigation'],
  noExternal: [/^@nexus\//],
  esbuildOptions(options) {
    options.conditions = ['@nexus/source', ...(options.conditions ?? [])];
  },
};

export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts' } },
  { ...shared, entry: { next: 'src/next.tsx' } },
]);
