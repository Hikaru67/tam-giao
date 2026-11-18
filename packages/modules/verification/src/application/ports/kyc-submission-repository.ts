import type { DomainError, Result, Tx } from '@tamgiao/kernel';
import type { KycSubmission, KycSubmissionId, KycUserId } from '../../domain/kyc-submission.js';

/**
 * Vi phạm ràng buộc DB khi lưu (AGENTS.md A10):
 * - `CCCD_ALREADY_REGISTERED`: số CCCD đã gắn với hồ sơ của tài khoản khác (unique trên blind index).
 * - `KYC_ALREADY_SUBMITTED`: người dùng đã có hồ sơ (unique `user_id`) — hai lần nộp đồng thời.
 * Sau `Err` transaction đã hỏng: use case phải trả `Err` ngay để UnitOfWork rollback.
 */
export type KycSaveError = DomainError<'CCCD_ALREADY_REGISTERED' | 'KYC_ALREADY_SUBMITTED'>;

export interface KycSubmissionRepository {
  findByUserId(tx: Tx, userId: KycUserId): Promise<KycSubmission | null>;
  /** Đọc và khoá dòng tới hết `tx`. */
  findByUserIdForUpdate(tx: Tx, userId: KycUserId): Promise<KycSubmission | null>;
  findById(tx: Tx, id: KycSubmissionId): Promise<KycSubmission | null>;
  /** Đọc và khoá dòng theo `id` tới hết `tx` (`SELECT … FOR UPDATE`) — hai quyết định đồng thời chạy tuần tự. */
  findByIdForUpdate(tx: Tx, id: KycSubmissionId): Promise<KycSubmission | null>;
  /** Upsert theo `id`; mã hoá số CCCD + blind index; ghi event chưa phát vào outbox trong cùng `tx`. */
  save(tx: Tx, submission: KycSubmission): Promise<Result<void, KycSaveError>>;
}
