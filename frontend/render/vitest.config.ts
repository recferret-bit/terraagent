import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/render', include: ['planets/**/*.spec.ts'], exclude: ['**/node_modules/**'] } });
