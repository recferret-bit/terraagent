import { defineConfig } from 'vitest/config';

// Generation-heavy suites (100-seed spawn guarantees, world profiles) need more than vitest's 5 s when the whole
// monorepo runs in parallel.
export default defineConfig({ test: { name: '@terra/sim', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'], testTimeout: 30_000 } });
