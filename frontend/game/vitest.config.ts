import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { name: '@terra/game', include: ['core/**/*.spec.ts', 'features/**/*.spec.ts', 'net/**/*.spec.ts', 'store/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'] } });
