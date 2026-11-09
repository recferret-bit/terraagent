import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// W13-49 economy acceptance pack, the parts that need no database. The Postgres parts are `*.int.spec.ts` (`npm run test:integration`).
export default defineConfig({
  test: {
    name: '@terra/economy-acceptance',
    include: ['acceptance/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/*.int.spec.ts'],
    testTimeout: 120_000,
  },
  root: resolve(import.meta.dirname),
});
