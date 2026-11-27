import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { E2E_RUN_DIR } from './env';
import type { SeededUser } from './users';

export const ADMIN_SEED_FILE = join(E2E_RUN_DIR, 'playwright/admin-seed.json');

export interface AdminProjectSeed {
  readonly kycUser: SeededUser;
  readonly matchUserA: SeededUser;
  readonly matchUserB: SeededUser;
  readonly reportId: string;
  readonly reporter: SeededUser;
  readonly reported: SeededUser;
}

export type AdminSeed = Readonly<Record<string, AdminProjectSeed>>;

/** Ghi dữ liệu seed ra JSON với quyền chỉ chủ sở hữu đọc/ghi (chứa accessToken test). */
export function writeSeed(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Đọc dữ liệu seed từ JSON; ném lỗi rõ ràng nếu thiếu file. */
export function readSeed<T>(file: string): T {
  if (!existsSync(file)) {
    throw new Error(`Không tìm thấy file seed "${file}". Hãy chạy globalSetup trước.`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Lấy dữ liệu seed ứng với tên project Playwright. */
export function seedFor<T>(all: Readonly<Record<string, T>>, projectName: string): T {
  const value = all[projectName];
  if (value === undefined) {
    throw new Error(`Không tìm thấy dữ liệu seed cho project "${projectName}".`);
  }
  return value;
}
