import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // Relative asset paths so the same build works from the dev server, from a
  // local `vite preview`, and from a GitHub Pages project sub-path
  // (https://<user>.github.io/monopoly-forge/). The game is a single canvas
  // page with no client-side routing, so no `404.html` fallback is needed.
  base: './',
  resolve: {
    alias: {
      // `__dirname` is unavailable in an ESM config ("type": "module").
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Phaser alone is ~1.48 MB minified and is split into its own chunk below;
    // the default 500 kB limit can never be met with it bundled. Raised so a
    // clean build reports zero warnings and a real regression would stand out.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
