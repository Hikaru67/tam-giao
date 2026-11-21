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
    files: ['tools/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
