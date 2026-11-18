import type { Tx } from '@tamgiao/kernel';
import type { KycStatus, KycSubmissionId } from '../../domain/kyc-submission.js';

/** Vị trí của một hồ sơ trong thứ tự quét `(decidedAt, submissionId)` — dùng làm cursor giữa các lô. */
export interface KycMediaCursor {
  readonly submissionId: KycSubmissionId;
  readonly decidedAt: Date;
}

/** Ảnh còn lưu của một hồ sơ (chỉ key khác null) + dữ liệu để kiểm tra lại hạn lưu sau khi khoá dòng. */
export interface KycStoredMedia {
  readonly submissionId: KycSubmissionId;
  readonly status: KycStatus;
  readonly decidedAt: Date | null;
  /** Key object bucket `privateKyc` còn được tham chiếu — chứa id người dùng, không log. */
  readonly keys: readonly string[];
}

/**
 * Truy cập hẹp vào `verification.kyc_submissions` cho job xoá ảnh theo thời hạn lưu (BE-S3-06). Không dựng
 * aggregate `KycSubmission` để khỏi giải mã số CCCD (tối thiểu hoá dữ liệu) và không đổi `version`.
 */
export interface KycMediaRetentionRepository {
  /**
   * Hồ sơ `APPROVED`/`REJECTED` có `decidedAt < decidedBefore` và còn ít nhất một key ảnh, theo thứ tự
   * `(decidedAt, submissionId)` tăng dần, sau `after` (không khoá dòng).
   */
  findExpired(
    tx: Tx,
    query: { readonly decidedBefore: Date; readonly after: KycMediaCursor | null; readonly limit: number },
  ): Promise<readonly KycMediaCursor[]>;
  /**
   * Khoá dòng tới hết `tx` (`SELECT … FOR UPDATE SKIP LOCKED`); `null` khi không có hồ sơ hoặc dòng đang bị
   * transaction khác giữ (lượt chạy song song của job / chuyên viên đang thao tác) — bỏ qua, lượt sau xử lý.
   */
  lockMedia(tx: Tx, submissionId: KycSubmissionId): Promise<KycStoredMedia | null>;
  /** Đặt cả 4 cột key ảnh = NULL, cập nhật `updatedAt` (không đổi `version`, không phát event). */
  clearMedia(tx: Tx, submissionId: KycSubmissionId, now: Date): Promise<void>;
}
