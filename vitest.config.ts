import { defineConfig } from 'vitest/config';

const ignored = ['**/node_modules/**', '**/dist/**', 'design/**', 'tools/lint-fixtures/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages,tools}/**/*.test.ts'],
          exclude: [
            ...ignored,
            '**/*.int.test.ts',
            'apps/{admin,partner,mobile}/**',
            'packages/{ui-web,ui-mobile}/**',
            'packages/ui-core/src/**/*.test.tsx',
          ],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{apps,packages,tools}/**/*.int.test.ts'],
          exclude: ignored,
          // 1 Postgres (Testcontainers) cho cả lượt chạy; file PHẢI chạy tuần tự vì dùng chung DB + resetDatabase.
          // `fileParallelism` ở cấp project bị Vitest 3 bỏ qua → dùng 1 fork duy nhất để ép tuần tự.
          globalSetup: ['./packages/testing/src/postgres-global-setup.ts'],
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'web',
          include: [
            'apps/{admin,partner}/src/**/*.test.{ts,tsx}',
            'packages/{ui-web,ui-core}/src/**/*.test.tsx',
          ],
          exclude: ignored,
          environment: 'jsdom',
          // Testing Library chỉ tự `cleanup` sau mỗi test khi có `afterEach` toàn cục → bật globals cho project web.
          globals: true,
        },
        esbuild: {
          jsx: 'automatic',
        },
      },
    ],
  },
});
