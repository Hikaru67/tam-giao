import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Test meta cho flow Maestro (FE-S6-01) — chạy trong `pnpm test` qua script `test:native` của apps/mobile.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['**/*.test.ts'], environment: 'node' },
});
