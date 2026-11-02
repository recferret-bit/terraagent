import { defineConfig } from 'vitest/config';

// `npm run coverage` (in this folder) enforces 100 % coverage of src/. types.ts holds only types, so it has no runtime code.
export default defineConfig({
  test: {
    name: '@terra/ledger',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
