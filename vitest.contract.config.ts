import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// `npm run test:contract` / `npm run contract:real`: the port contract runner only. It needs Postgres (`npm run db:up`),
// like the integration suite, but is not an `*.int.spec.ts` so neither the default run nor `test:integration` repeats it.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    name: 'contract',
    include: ['backend/app/test/contract/*.contract.spec.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
    environment: 'node',
    reporters: ['verbose'],
    pool: 'threads',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
