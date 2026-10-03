import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Fast checks with no browser, server or account: `npm test`.
// The full walkthroughs in a real browser are `npm run test:e2e` (see tests/e2e/run.mjs).
export default defineConfig({
  // Same reason as vite.config.ts: OneDrive locks files inside the project while syncing.
  cacheDir: join(tmpdir(), 'rabbit-hole-vitest'),
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
