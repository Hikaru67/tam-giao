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
        },
      },
    ],
  },
});
