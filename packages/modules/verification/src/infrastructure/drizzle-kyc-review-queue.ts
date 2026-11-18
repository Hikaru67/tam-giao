import { asDbTx } from '@tamgiao/db';
import type { Tx } from '@tamgiao/kernel';
import { and, asc, inArray, isNotNull, ne, not, sql, type SQL } from 'drizzle-orm';
import type {
  KycQueueCursor,
  KycQueueFilter,
  KycQueueRow,
  KycReviewQueue,
} from '../application/ports/kyc-review-queue.js';
import { KYC_STATUSES, type KycStatus, type KycSubmissionId } from '../domain/kyc-submission.js';
import { parseAssessment, parseSteps } from './drizzle-kyc-submission-repository.js';
import { kycSubmissions } from './schema.js';

const a = kycSubmissions.ekycAssessment;

/**
 * Hồ sơ "có cờ eKYC" — viết lại bằng SQL đúng định nghĩa `ekycFlags()` ở domain (danh sách cờ khác rỗng):
 * chưa có đánh giá, một thao tác không `OK`, hoặc `profileMismatches` không phải mảng rỗng (null = không đối chiếu
 * được, mảng có phần tử = lệch). Dùng `case` để không gọi `jsonb_array_length` trên giá trị không phải mảng.
 */
const FLAGGED_SQL: SQL = sql`(
  ${a} is null
  or (${a}->'ocr'->>'status') is distinct from 'OK'
  or (${a}->'liveness'->>'status') is distinct from 'OK'
  or (${a}->'faceMatch'->>'status') is distinct from 'OK'
  or case when jsonb_typeof(${a}->'profileMismatches') = 'array'
       then jsonb_array_length(${a}->'profileMismatches') > 0
       else true end
)`;

const isStatus = (v: string): v is KycStatus => (KYC_STATUSES as readonly string[]).includes(v);

/** Hàng chờ duyệt eKYC (read model) trên `verification.kyc_submissions`; dùng index `(status, submitted_at)`. */
export class DrizzleKycReviewQueue implements KycReviewQueue {
  async search(
    tx: Tx,
    filter: KycQueueFilter,
    cursor: KycQueueCursor | null,
    limit: number,
  ): Promise<readonly KycQueueRow[]> {
    const conditions: SQL[] = [
      ne(kycSubmissions.status, 'DRAFT'),
      isNotNull(kycSubmissions.submittedAt),
      inArray(kycSubmissions.status, [...filter.statuses]),
    ];
    if (filter.flagged === true) conditions.push(FLAGGED_SQL);
    if (filter.flagged === false) conditions.push(not(FLAGGED_SQL));
    if (filter.userIds !== undefined) conditions.push(inArray(kycSubmissions.userId, [...filter.userIds]));
    if (cursor !== null) {
      conditions.push(
        sql`(${kycSubmissions.submittedAt}, ${kycSubmissions.id}) > (${cursor.submittedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await asDbTx(tx)
      .select()
      .from(kycSubmissions)
      .where(and(...conditions))
      .orderBy(asc(kycSubmissions.submittedAt), asc(kycSubmissions.id))
      .limit(limit);

    return rows.map((row): KycQueueRow => {
      if (!isStatus(row.status) || row.submittedAt === null) {
        throw new Error(`verification.kyc_submissions ${row.id}: dòng hàng chờ không hợp lệ`);
      }
      return {
        id: row.id as KycSubmissionId,
        userId: row.userId,
        status: row.status,
        steps: parseSteps(row),
        ekycAssessment: row.ekycAssessment === null ? null : parseAssessment(row),
        reviewerId: row.reviewerId,
        submittedAt: row.submittedAt,
        updatedAt: row.updatedAt,
      };
    });
  }
}
