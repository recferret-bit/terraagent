// Flat ESLint config for the whole monorepo (`npm run lint`). Package-specific rule sets (e.g. the sim purity rules)
// live in their package as `eslint.rules.js` and are spread in below, so a package adds rules without editing this list.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { simPurity } from './shared/sim/eslint.rules.js';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', '.agents/**', 'docs/**', 'e2e/.out/**', 'playwright-report/**', 'test-results/**', 'shared/sim/test/lint/*.fixture.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['frontend/**/*.{ts,js}'],
    languageOptions: { globals: { ...globals.browser } },
    // the prototype predates the linter; keep it green without rewriting it (new code should not need these)
    rules: {
      '@typescript-eslint/no-explicit-any': 'off', 'no-empty': 'off', 'prefer-const': 'off',
      '@typescript-eslint/no-unused-vars': 'off', '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
  {
    files: ['backend/app/src/near/**/*.ts', 'backend/app/src/ports/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  ...simPurity,
);
