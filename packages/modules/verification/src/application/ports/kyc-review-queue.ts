import type { Tx } from '@tamgiao/kernel';
import type {
  EkycAssessment,
  KycStatus,
  KycSteps,
  KycSubmissionId,
  ReviewerId,
} from '../../domain/kyc-submission.js';

/** Vị trí trong hàng chờ (sắp xếp `submittedAt` tăng dần, rồi `id`). */
export interface KycQueueCursor {
  readonly submittedAt: Date;
  readonly id: string;
}

export interface KycQueueFilter {
  /** Trạng thái cần lấy (không rỗng). Hồ sơ `DRAFT` (chưa nộp) không bao giờ có trong hàng chờ. */
  readonly statuses: readonly KycStatus[];
  /** `true` = chỉ hồ sơ có cờ eKYC; `false` = chỉ hồ sơ không cờ; bỏ trống = tất cả. */
  readonly flagged?: boolean;
  /** Giới hạn trong các người dùng này (kết quả tìm theo tên/nghề); bỏ trống = không giới hạn. */
  readonly userIds?: readonly string[];
}

/** Một dòng hàng chờ (read model: không dựng aggregate, không giải mã CCCD). */
export interface KycQueueRow {
  readonly id: KycSubmissionId;
  readonly userId: string;
  readonly status: KycStatus;
  readonly steps: KycSteps;
  readonly ekycAssessment: EkycAssessment | null;
  readonly reviewerId: ReviewerId | null;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
}

/** Truy vấn hàng chờ duyệt eKYC của admin. */
export interface KycReviewQueue {
  /** Hồ sơ chờ lâu nhất trước; trả tối đa `limit` dòng sau `cursor`. */
  search(
    tx: Tx,
    filter: KycQueueFilter,
    cursor: KycQueueCursor | null,
    limit: number,
  ): Promise<readonly KycQueueRow[]>;
}
