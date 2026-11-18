import { asDbTx } from '@tamgiao/db';
import { ok, type UnitOfWork } from '@tamgiao/kernel';
import { asc, ilike, inArray, or } from 'drizzle-orm';
import type { ApplicantSummary } from '../application/facade.js';
import { profiles } from './schema.js';

/** Thoát ký tự đại diện của `LIKE` (`\`, `%`, `_`) để tìm đúng chuỗi người dùng nhập. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Tra cứu hồ sơ cho màn duyệt eKYC của admin (BE-S3-04) — hiện thực 2 hàm của `ProfileFacade`.
 * Module "mỏng" (A11): truy vấn thẳng bảng `profile.profiles`, không qua aggregate.
 */
export class DrizzleApplicantDirectory {
  constructor(private readonly uow: UnitOfWork) {}

  async searchUserIds(text: string, limit: number): Promise<readonly string[]> {
    const needle = text.trim();
    if (needle.length === 0 || limit <= 0) return [];
    const pattern = `%${escapeLike(needle)}%`;
    const found = await this.uow.run(async (tx) =>
      ok(
        await asDbTx(tx)
          .select({ userId: profiles.userId })
          .from(profiles)
          .where(or(ilike(profiles.fullName, pattern), ilike(profiles.occupation, pattern)))
          .orderBy(asc(profiles.userId))
          .limit(limit),
      ),
    );
    return found.unwrapOr([]).map((r) => r.userId);
  }

  async getApplicantSummaries(userIds: readonly string[]): Promise<readonly ApplicantSummary[]> {
    if (userIds.length === 0) return [];
    const found = await this.uow.run(async (tx) =>
      ok(
        await asDbTx(tx)
          .select({ userId: profiles.userId, fullName: profiles.fullName, occupation: profiles.occupation })
          .from(profiles)
          .where(inArray(profiles.userId, [...new Set(userIds)])),
      ),
    );
    return found.unwrapOr([]);
  }
}
