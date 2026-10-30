import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// `npm run test:integration`: only `*.int.spec.ts`, which need Postgres (`npm run db:up`). The default `npx vitest run`
// excludes them. Files run one at a time; each creates its own throwaway database via `@terra/db/testing`.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'integration',
    include: ['**/*.int.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    reporters: ['verbose'], // shows the [test-db] created/migrated/dropped log lines
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
