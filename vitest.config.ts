import { defineConfig } from 'vitest/config';

const ignored = ['**/node_modules/**', '**/dist/**', 'design/**', 'tools/lint-fixtures/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,tools}/**/*.test.ts'],
          exclude: [...ignored, '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{apps,packages,tools}/**/*.int.test.ts'],
          exclude: ignored,
          // 1 Postgres (Testcontainers) cho cả lượt chạy; file chạy tuần tự vì dùng chung DB + resetDatabase.
          globalSetup: ['./packages/testing/src/postgres-global-setup.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
