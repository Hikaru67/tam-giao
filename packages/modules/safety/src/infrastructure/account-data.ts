import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { DomainEvent, ObjectStorage, Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { asc, eq } from 'drizzle-orm';
import { reports } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module safety (BE-S7-06). Báo cáo vi phạm và quyết định khoá tài khoản là hồ sơ an toàn
 * phải giữ → **không xoá dòng**, chỉ xoá phần nội dung do người dùng tự nhập (mô tả, ảnh bằng chứng) ở báo cáo do chính
 * họ gửi; id người gửi/bị báo cáo chỉ còn là UUID không liên kết được tới danh tính sau khi identity xoá SĐT.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'safety.erase-on-account-deletion';

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

/**
 * `AccountDeletionRequested` → báo cáo do người này gửi: xoá ảnh bằng chứng (bucket `privateKyc`), `evidence_keys` = rỗng,
 * `description` = NULL; giữ loại, mức độ, trạng thái, kết luận của chuyên viên. Báo cáo **về** người này giữ nguyên (nội
 * dung là của người báo cáo). `user_bans` giữ nguyên. Idempotent (A9).
 */
export function registerSafetyAccountDeletionConsumer(
  bus: EventBus,
  deps: { readonly storage: ObjectStorage },
): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, SAFETY_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const db = asDbTx(tx);
    const filed = await db
      .select({ id: reports.id, evidenceKeys: reports.evidenceKeys })
      .from(reports)
      .where(eq(reports.reporterId, userId))
      .for('update');
    for (const report of filed) {
      for (const key of report.evidenceKeys) await deps.storage.delete('privateKyc', key);
    }
    if (filed.length > 0) {
      await db
        .update(reports)
        .set({ description: null, evidenceKeys: [] })
        .where(eq(reports.reporterId, userId));
    }
  });
}

/**
 * Mục `safety` của file xuất: các báo cáo do chính người này gửi (loại, mô tả, trạng thái, ảnh bằng chứng). Không gồm báo
 * cáo người khác gửi về họ (lộ danh tính + nội dung của người báo cáo) và lý do khoá (đánh giá nội bộ).
 */
export function createSafetyPersonalDataSource(): PersonalDataSource {
  return {
    section: 'safety',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const filed = await asDbTx(tx)
        .select()
        .from(reports)
        .where(eq(reports.reporterId, userId))
        .orderBy(asc(reports.createdAt));
      return {
        data: {
          reportsFiled: filed.map((r) => ({
            reportId: r.id,
            category: r.category,
            description: r.description,
            urgent: r.urgent,
            status: r.status,
            createdAt: r.createdAt.toISOString(),
            closedAt: r.closedAt?.toISOString() ?? null,
          })),
        },
        files: filed.flatMap((r) =>
          r.evidenceKeys.map((key, i) => ({
            bucket: 'privateKyc' as const,
            key,
            label: `report_${r.id}_evidence_${i + 1}`,
          })),
        ),
      };
    },
  };
}
