import { ACCOUNT_DELETION_REQUESTED } from '@tamgiao/contracts';
import { asDbTx, type EventBus } from '@tamgiao/db';
import type { Clock, DomainEvent, Encryptor, ObjectStorage, Tx } from '@tamgiao/kernel';
import type { PersonalDataSection, PersonalDataSource } from '@tamgiao/module-identity/facade';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { interviewSlots, kycSubmissions } from './schema.js';

/**
 * Quyền dữ liệu cá nhân của module verification (BE-S7-06): consumer xoá/ẩn danh khi người dùng xoá tài khoản + nguồn
 * dữ liệu cho file xuất. Thao tác dữ liệu thuần (không có luật chuyển trạng thái) nên viết thẳng ở hạ tầng.
 */

/** Tên consumer (duy nhất toàn hệ thống) — đổi tên = consumer mới, event cũ bị xử lý lại. */
export const VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER = 'verification.erase-on-account-deletion';

/** Hồ sơ chưa có quyết định — xoá hẳn khi xoá tài khoản (không để hồ sơ "ma" trong hàng chờ duyệt). */
const UNDECIDED_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'NEEDS_MORE_INFO'];

function userIdOf(event: DomainEvent): string {
  const payload = event.payload;
  if (typeof payload === 'object' && payload !== null) {
    const userId = (payload as { userId?: unknown }).userId;
    if (typeof userId === 'string' && userId.length > 0) return userId;
  }
  throw new Error(`${event.type} ${event.eventId}: payload thiếu userId`);
}

const mediaKeysOf = (row: typeof kycSubmissions.$inferSelect): string[] =>
  [row.cccdFrontKey, row.cccdBackKey, row.selfieKey, row.maritalStatusCertificateKey].filter(
    (k): k is string => k !== null,
  );

/**
 * `AccountDeletionRequested` → (1) xoá 4 ảnh eKYC (bucket `privateKyc`); (2) hồ sơ chưa quyết định → xoá hẳn; hồ sơ đã
 * `APPROVED`/`REJECTED` → giữ bản ghi quyết định ẩn danh (trạng thái, các bước, thời điểm, mã từ chối) nhưng xoá số CCCD
 * mã hoá + blind index, key ảnh, đánh giá eKYC, ghi chú từ chối / yêu cầu bổ sung; (3) lịch phỏng vấn đang đặt → trả slot
 * về `OPEN`; lịch đã phỏng vấn → xoá nhận xét (có thể chứa PII), giữ kết quả. Idempotent (A9): chạy lại không còn gì để
 * xoá; xoá object storage không lỗi khi đã mất.
 */
export function registerVerificationAccountDeletionConsumer(
  bus: EventBus,
  deps: { readonly storage: ObjectStorage; readonly clock: Clock },
): void {
  bus.on(ACCOUNT_DELETION_REQUESTED, VERIFICATION_ERASE_ON_ACCOUNT_DELETION_CONSUMER, async (event, tx) => {
    const userId = userIdOf(event);
    const db = asDbTx(tx);
    const now = deps.clock.now();
    const [submission] = await db
      .select()
      .from(kycSubmissions)
      .where(eq(kycSubmissions.userId, userId))
      .for('update');
    if (submission) {
      for (const key of mediaKeysOf(submission)) await deps.storage.delete('privateKyc', key);
      if (UNDECIDED_STATUSES.includes(submission.status)) {
        await db.delete(kycSubmissions).where(eq(kycSubmissions.id, submission.id));
      } else {
        await db
          .update(kycSubmissions)
          .set({
            cccdNumberEnc: null,
            cccdNumberBidx: null,
            cccdFrontKey: null,
            cccdBackKey: null,
            selfieKey: null,
            maritalStatusCertificateKey: null,
            ekycAssessment: null,
            moreInfoRequest: null,
            rejectionNote: null,
            updatedAt: now,
          })
          .where(eq(kycSubmissions.id, submission.id));
      }
    }
    await db
      .update(interviewSlots)
      .set({ status: 'OPEN', bookedBy: null, bookedAt: null, updatedAt: now })
      .where(and(eq(interviewSlots.bookedBy, userId), eq(interviewSlots.status, 'BOOKED')));
    await db
      .update(interviewSlots)
      .set({ notes: null, updatedAt: now })
      .where(
        and(
          eq(interviewSlots.bookedBy, userId),
          eq(interviewSlots.status, 'COMPLETED'),
          isNotNull(interviewSlots.notes),
        ),
      );
  });
}

/**
 * Mục `verification` của file xuất: trạng thái hồ sơ, các bước, số CCCD (giải mã — dữ liệu của chính chủ), ảnh eKYC
 * còn lưu, lịch phỏng vấn (giờ, kết quả). Không gồm đánh giá nội bộ của chuyên viên (nhận xét phỏng vấn, điểm eKYC).
 */
export function createVerificationPersonalDataSource(encryptor: Encryptor): PersonalDataSource {
  return {
    section: 'verification',
    async collect(tx: Tx, userId: string): Promise<PersonalDataSection> {
      const db = asDbTx(tx);
      const [s] = await db.select().from(kycSubmissions).where(eq(kycSubmissions.userId, userId));
      const interviews = await db
        .select()
        .from(interviewSlots)
        .where(eq(interviewSlots.bookedBy, userId))
        .orderBy(asc(interviewSlots.startsAt));
      const labelled: [string, string | null][] = s
        ? [
            ['cccd_front', s.cccdFrontKey],
            ['cccd_back', s.cccdBackKey],
            ['selfie', s.selfieKey],
            ['marital_status_certificate', s.maritalStatusCertificateKey],
          ]
        : [];
      const files = labelled.flatMap(([label, key]) =>
        key === null ? [] : [{ bucket: 'privateKyc' as const, key, label }],
      );
      return {
        data: {
          kyc: s
            ? {
                status: s.status,
                steps: s.steps,
                cccdNumber:
                  s.cccdNumberEnc === null
                    ? null
                    : await encryptor.decrypt(
                        s.cccdNumberEnc,
                        `verification.kyc_submissions.cccd_number:${userId}`,
                      ),
                rejectionCode: s.rejectionCode,
                submittedAt: s.submittedAt?.toISOString() ?? null,
                decidedAt: s.decidedAt?.toISOString() ?? null,
                createdAt: s.createdAt.toISOString(),
              }
            : null,
          interviews: interviews.map((i) => ({
            startsAt: i.startsAt.toISOString(),
            endsAt: i.endsAt.toISOString(),
            status: i.status,
            outcome: i.outcome,
          })),
        },
        files,
      };
    },
  };
}
