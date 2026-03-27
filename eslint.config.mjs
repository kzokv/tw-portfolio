// @ts-check
/**
 * ESLint flat config — single source of truth for the repo.
 *
 * STANDARD RULES (community best practices, adopt first):
 * - eslint.configs.recommended: core JS (no unused vars, no debugger, etc.)
 * - tseslint.configs.recommended: TypeScript recommended (no-explicit-any,
 *   no-floating-promises, etc.). typescript-eslint's recommended set already
 *   implies the "eslint-recommended" overrides that disable JS rules TS covers.
 *
 * CUSTOM RULES (project-specific, add only after standard set passes and team agrees):
 * - Naming: @typescript-eslint/naming-convention for handlers, components, constants
 * - Import boundaries: no-restricted-imports or plugin so apps/* don't import other apps
 * - Env/security: restrict process.env in libs or allowlist in app code
 * - Test overrides: relax in test dirs and *.test.ts / *.spec.ts files
 * - Document any rule turned off with a short comment
 *
 * PLAYWRIGHT: eslint-plugin-playwright recommended rules apply only to TS files under apps/web/tests/e2e
 * (e.g. missing-playwright-await, no-focused-test, no-page-pause, expect-expect).
 */
import eslint from '@eslint/js';
import globals from 'globals';
import playwright from 'eslint-plugin-playwright';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/build/**',
      '**/.turbo/**',
      '**/vitest-report/**',
      '.worktrees/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  // Allow underscore-prefixed args (standard TS convention for intentionally unused params)
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Node.js globals for .mjs scripts (process, Buffer, URLSearchParams, etc.)
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  // Playwright recommended rules for e2e test files only
  {
    files: ['apps/web/tests/e2e/**/*.ts'],
    ...playwright.configs['flat/recommended'],
  },
  // AAA specs assert through assistants and shared Step-annotated helpers instead of raw expect() calls.
  {
    files: ['apps/web/tests/e2e/**/*-aaa.spec.ts'],
    rules: {
      'playwright/expect-expect': 'off',
    },
  },
  // Setup files require conditional skip logic — relax Playwright test-purity rules
  {
    files: ['apps/web/tests/e2e/setup/**/*.ts'],
    rules: {
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-skipped-test': 'off',
    },
  },
  // Prevent env-web.ts from importing env.ts — fs.readFileSync crashes Edge Runtime
  {
    files: ['libs/config/src/env-web.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: './env', message: 'env-web.ts must not import from env.ts — fs.readFileSync crashes Edge Runtime' },
          { name: './env.js', message: 'env-web.ts must not import from env.ts — fs.readFileSync crashes Edge Runtime' },
        ],
      }],
    },
  },
];
