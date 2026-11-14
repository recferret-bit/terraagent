import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@terra/landing',
    include: ['**/*.spec.ts'],
    exclude: ['**/node_modules/**'],
  },
});
