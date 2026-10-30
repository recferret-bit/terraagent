import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// SWC instead of esbuild so NestJS gets `emitDecoratorMetadata` (constructor injection by type).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { name: '@terra/app', include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'], exclude: ['**/*.int.spec.ts', '**/node_modules/**'], environment: 'node' },
});
