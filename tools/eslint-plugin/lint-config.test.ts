import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Kiểm tra cấu hình eslint.config.js thật (không chỉ rule riêng lẻ) bắt được vi phạm A1/A3 trên file mẫu.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = (rel: string) => path.join(repoRoot, 'tools/lint-fixtures', rel);

async function lint(file: string) {
  const eslint = new ESLint({ cwd: repoRoot, ignore: false });
  const [result] = await eslint.lintFiles([file]);
  return result?.messages.map((m) => m.ruleId) ?? [];
}

describe('eslint.config.js — luật kiến trúc', () => {
  it('báo lỗi khi domain import drizzle-orm và hono (A1)', async () => {
    const rules = await lint(fixture('packages/modules/matching/src/domain/imports-framework.ts'));
    expect(rules.filter((r) => r === 'tamgiao/architecture-boundaries')).toHaveLength(2);
  });

  it('báo lỗi khi module import domain/infrastructure của module khác (A3)', async () => {
    const rules = await lint(fixture('packages/modules/matching/src/application/imports-other-module.ts'));
    expect(rules.filter((r) => r === 'tamgiao/architecture-boundaries')).toHaveLength(2);
  });

  it('báo lỗi default export', async () => {
    const rules = await lint(fixture('packages/modules/matching/src/domain/default-export.ts'));
    expect(rules).toContain('import-x/no-default-export');
  });
});
