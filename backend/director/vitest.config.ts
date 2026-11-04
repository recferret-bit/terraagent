import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@terra/director',
    include: ['test/**/*.spec.ts'],
  },
});
