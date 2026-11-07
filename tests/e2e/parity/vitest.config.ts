import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@terra/parity',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
