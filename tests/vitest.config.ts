import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const root = resolve(import.meta.dirname, '..');
process.env.SWC_NODE_PROJECT ??= resolve(root, 'shared/tsconfig.base.json');

// One `vitest run` runs every workspace that has tests; each project may add its own vitest.config.ts.
export default defineConfig({
  root,
  test: {
    projects: ['shared/*/vitest.config.ts', 'tests/scenarios', 'backend/app', 'backend/director', 'frontend/game', 'frontend/render'],
    coverage: { reportsDirectory: resolve(import.meta.dirname, '.out/coverage') },
  },
});
