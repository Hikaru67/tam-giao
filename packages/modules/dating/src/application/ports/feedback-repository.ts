import type { DomainError, Result, Tx } from '@tamgiao/kernel';
import type { DateFeedback, DateFeedbackId } from '../../domain/date-feedback.js';
import type { DatingMatchId, DatingUserId } from '../../domain/date-plan.js';

/** Người dùng đã có đánh giá cho match (unique `(match_id, author_id)`, A10). */
export type FeedbackAddError = DomainError<'FEEDBACK_ALREADY_SUBMITTED'>;

/** Một cờ "Có khác biệt so với eKYC" trong hàng chờ chuyên viên — chỉ id + mốc thời gian. */
export interface AppearanceFlagRow {
  readonly feedbackId: DateFeedbackId;
  readonly matchId: DatingMatchId;
  readonly datePlanId: string;
  readonly authorId: DatingUserId;
  readonly subjectId: DatingUserId;
  readonly submittedAt: Date;
}

export interface AppearanceFlagPage {
  readonly total: number;
  readonly items: readonly AppearanceFlagRow[];
}

/** Lưu trữ `DateFeedback` (`dating.feedbacks`) + outbox, trong `tx` của caller (A5, A6). Đánh giá bất biến. */
export interface FeedbackRepository {
  /**
   * Khoá giao dịch theo match (`pg_advisory_xact_lock`) tới hết `tx` — tuần tự hoá hai người gửi đánh giá cùng lúc để
   * `FeedbackSubmitted` phát đúng một lần (kể cả khi chưa có dòng nào để `FOR UPDATE`).
   */
  lockMatch(tx: Tx, matchId: DatingMatchId): Promise<void>;
  /**
   * INSERT đánh giá mới + event chờ (0 hoặc 1) vào outbox cùng `tx`. Trùng `(match_id, author_id)` →
   * `FEEDBACK_ALREADY_SUBMITTED` (caller trả `Err` để UnitOfWork rollback).
   */
  add(tx: Tx, feedback: DateFeedback): Promise<Result<void, FeedbackAddError>>;
  findById(tx: Tx, id: DateFeedbackId): Promise<DateFeedback | null>;
  /** Đánh giá của `authorId` cho match (tối đa một). */
  findByMatchAndAuthor(tx: Tx, matchId: DatingMatchId, authorId: DatingUserId): Promise<DateFeedback | null>;
  /** Hàng chờ cờ `profile_match = 'DIFFERENT'`, mới gửi trước (`submitted_at desc, id desc`). */
  listAppearanceFlags(
    tx: Tx,
    page: { readonly limit: number; readonly offset: number },
  ): Promise<AppearanceFlagPage>;
}
