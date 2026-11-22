import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { tamgiaoPlugin } from './tools/eslint-plugin/index.js';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      // Worktree tạm của agent (Claude Code) — bản sao repo, không lint.
      '.claude/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      'design/**',
      'tools/lint-fixtures/**',
      'apps/mobile/.expo/**',
      'apps/*/dist/**',
      'apps/mobile/babel.config.js',
      'packages/ui-mobile/babel.config.js',
      'apps/mobile/metro.config.js',
      'apps/mobile/tailwind.config.js',
      'apps/*/postcss.config.js',
      'packages/ui-web/postcss.config.js',
      'packages/*/storybook-static/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    plugins: { 'import-x': importX, tamgiao: tamgiaoPlugin },
    rules: {
      'tamgiao/architecture-boundaries': 'error',
      'import-x/no-default-export': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'error',
    },
  },
  {
    // File cấu hình công cụ bắt buộc dùng default export.
    files: ['**/*.config.{js,mjs,ts}', 'eslint.config.js'],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    // Storybook stories và configs được phép dùng default export.
    files: ['**/*.stories.tsx', '**/.storybook/**'],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    files: ['tools/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      '**/apps/{mobile,admin,partner}/**/*.{ts,tsx}',
      '**/packages/{ui-core,ui-web,ui-mobile,api-client}/**/*.{ts,tsx}',
    ],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@tamgiao/module-*',
                '@tamgiao/db',
                '@tamgiao/db/*',
                '@tamgiao/http',
                '@tamgiao/http/*',
                '@tamgiao/config',
                '@tamgiao/testing',
                '@tamgiao/kernel',
              ],
              message: 'App FE chỉ được import @tamgiao/contracts và package FE (luật F1, FE-S1-01).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/mobile/app/**/*.tsx'],
    rules: { 'import-x/no-default-export': 'off' },
  },
  prettier,
);
