import { defineConfig } from 'vitest/config';

// One `vitest run` at the root runs every workspace that has tests; each project may add its own vitest.config.ts.
export default defineConfig({
  test: { projects: ['shared/*', 'scenarios', 'backend/app', 'frontend/game', 'frontend/render'] },
});
