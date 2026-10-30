import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/scenarios', include: ['test/**/*.spec.ts'], exclude: ['**/node_modules/**'] } });
