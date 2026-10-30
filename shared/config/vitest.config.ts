import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/config', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'] } });
