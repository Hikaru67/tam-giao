import type { DomainError, Result, Tx } from '@tamgiao/kernel';
import type { InterviewSlot, InterviewSlotId, InterviewSlotStatus } from '../../domain/interview-slot.js';
import type { KycUserId, ReviewerId } from '../../domain/kyc-submission.js';

/**
 * Vi phạm ràng buộc DB khi lưu (AGENTS.md A10):
 * - `INTERVIEW_ALREADY_BOOKED`: người dùng đã có lịch `BOOKED` khác (partial unique index trên `booked_by`).
 * - `INTERVIEW_SLOT_OVERLAP`: chuyên viên đã có slot cùng giờ bắt đầu (unique `interviewer_id, starts_at`).
 * Sau `Err` transaction đã hỏng: use case phải trả `Err` ngay để UnitOfWork rollback.
 */
export type InterviewSlotSaveError = DomainError<'INTERVIEW_ALREADY_BOOKED' | 'INTERVIEW_SLOT_OVERLAP'>;

export interface InterviewSlotListFilter {
  readonly status?: InterviewSlotStatus;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit: number;
}

export interface InterviewSlotRepository {
  findById(tx: Tx, id: InterviewSlotId): Promise<InterviewSlot | null>;
  /** Đọc và khoá dòng slot tới hết `tx` (hai người đặt cùng slot chạy tuần tự). */
  findByIdForUpdate(tx: Tx, id: InterviewSlotId): Promise<InterviewSlot | null>;
  /** Lịch `BOOKED` của người dùng (tối đa 1); có khoá dòng tới hết `tx`. */
  findActiveByUserForUpdate(tx: Tx, userId: KycUserId): Promise<InterviewSlot | null>;
  findActiveByUser(tx: Tx, userId: KycUserId): Promise<InterviewSlot | null>;
  /**
   * Chuyên viên đã có slot chồng lên `[startsAt, endsAt)` chưa. Khoá theo chuyên viên tới hết `tx` để hai lần mở
   * slot đồng thời của cùng chuyên viên chạy tuần tự.
   */
  hasOverlapForUpdate(tx: Tx, interviewerId: ReviewerId, startsAt: Date, endsAt: Date): Promise<boolean>;
  /** Slot `OPEN` bắt đầu sau `from`, tăng dần theo giờ bắt đầu. */
  listOpen(tx: Tx, input: { readonly from: Date; readonly limit: number }): Promise<InterviewSlot[]>;
  /** Nhật ký cho chuyên viên: giảm dần theo giờ bắt đầu. `from`/`to` lọc theo giờ bắt đầu (`[from, to)`). */
  list(tx: Tx, filter: InterviewSlotListFilter): Promise<InterviewSlot[]>;
  /** Upsert theo `id`. */
  save(tx: Tx, slot: InterviewSlot): Promise<Result<void, InterviewSlotSaveError>>;
}
