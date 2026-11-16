import { defineConfig } from 'drizzle-kit';

// .env là tuỳ chọn (CI truyền DATABASE_URL trực tiếp).
try {
  process.loadEnvFile('.env');
} catch {
  // không có .env
}

export default defineConfig({
  dialect: 'postgresql',
  // Schema hạ tầng + schema của từng module (mỗi module một Postgres schema, AGENTS.md mục 4).
  schema: ['./packages/db/src/schema/*.ts', './packages/modules/*/src/infrastructure/schema.ts'],
  out: './migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
