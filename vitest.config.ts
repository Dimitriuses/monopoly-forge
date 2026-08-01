import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The model layer (game/, tiles/, cards/, utils/) imports no Phaser and touches
// no DOM, so the suite runs in the plain `node` environment — no jsdom, no
// canvas shim. Anything that needs a browser is covered by tools/playtest.mjs.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
