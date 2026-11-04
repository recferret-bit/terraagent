import { defineConfig } from 'vitest/config';

// Feature discovery uses import.meta.glob; a cached transform can retain the pre-merge directory list.
export default defineConfig({ test: { name: '@terra/game', fsModuleCache: false, include: ['app/**/*.spec.ts', 'pages/**/*.spec.ts', 'camera/**/*.spec.ts', 'core/**/*.spec.ts', 'dev/**/*.spec.ts', 'features/**/*.spec.ts', 'maps/**/*.spec.ts', 'net/**/*.spec.ts', 'store/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'] } });
