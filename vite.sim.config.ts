import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// ─── The simulator's build ────────────────────────────────────────────────────
// `npm run simulate` runs a Node program made of the same TypeScript the game is
// made of, and Node cannot import that directly: the sources use `@/` aliases,
// which type stripping does not resolve.
//
// So it is bundled — by the Vite that is already a dependency, rather than by
// adding a TypeScript runner to `package.json`. A dependency change in this repo
// costs a `verify:install` run and has broken CI once (see KNOWNISSUES), and
// this build is ten lines.
//
// Output goes to `dist-sim/`, not `dist/`: `dist/` is what GitHub Pages
// publishes, and a Node bundle has no business being served to a browser.

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist-sim',
    emptyOutDir: true,
    // No minification: the only reader is a stack trace.
    minify: false,
    ssr: true,
    target: 'node22',
    rollupOptions: {
      input: fileURLToPath(new URL('./tools/simulate.ts', import.meta.url)),
      output: { entryFileNames: 'simulate.mjs', format: 'es' },
    },
  },
});
