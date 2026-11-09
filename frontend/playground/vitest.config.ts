import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@terra/playground',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
