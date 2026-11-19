/**
 * WHY: one build for all three entries. `@nexus/shared` is BUNDLED (noExternal) so the published
 * package has an EMPTY `dependencies`; only zod-free subpaths of shared are imported, so zod never
 * lands in a browser bundle. `react` / `next` stay external (peer dependencies).
 *
 * The `next` entry is built separately; tsup keeps its top-level `'use client'` directive (verified
 * in dist/next.js). Both entries share tracker state through a globalThis registry, so the
 * core being bundled twice (and the CJS/ESM dual-package case) is harmless.
 *
 * The `early` entry (`installNexusEarly`) has NO 'use client' banner (it runs from Next's
 * instrumentation-client.ts or a Vite module) and must stay small — dist/early.js ≤ 8 KiB as
 * shipped (ADR 0011; a test in early.test.ts would not see dist, so check `ls -l dist/early.js`
 * after a change): it never imports react, the tracker, the registry or the remote-config client,
 * and it reads leaf constants (SDK_BROWSER_*) instead of the whole SDK_DEFAULTS object. It is the
 * only entry built with Rollup tree-shaking (`treeshake`, which also drops the unused shared
 * constants esbuild keeps) and MINIFIED (comments and names are free in the source, not on every
 * page's critical path). The other two entries keep esbuild's output so the `'use client'`
 * directive is never stripped.
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
  {
    ...shared,
    entry: { early: 'src/early.ts' },
    treeshake: true,
    minify: true,
    esbuildOptions(options) {
      shared.esbuildOptions?.(options, { format: 'esm' });
      // Plain constructor assignments instead of the __publicField helper (same behaviour for
      // these classes, ~200 B less on the critical path).
      // tsup passes the tsconfig PATH; esbuild accepts a path or a raw config, not both.
      delete options.tsconfig;
      options.tsconfigRaw = { compilerOptions: { useDefineForClassFields: false } };
    },
  },
]);
