import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/contracts', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'] } });
