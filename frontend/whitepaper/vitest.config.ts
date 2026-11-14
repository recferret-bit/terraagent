import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@terra/whitepaper',
    include: ['**/*.test.ts', '**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
