import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/db', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'] } });
