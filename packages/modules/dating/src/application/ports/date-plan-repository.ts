import type { DomainError, Result, Tx } from '@tamgiao/kernel';
import type { DatePlan, DatePlanId, DatingMatchId } from '../../domain/date-plan.js';

/** Lưu lịch mới vi phạm "mỗi match tối đa một lịch đang mở" (partial unique index, A10). */
export type DatePlanSaveError = DomainError<'DATE_ALREADY_OPEN'>;

/** Lưu trữ aggregate `DatePlan` (`dating.date_plans`) + outbox, trong `tx` của caller (A5, A6). */
export interface DatePlanRepository {
  /**
   * Ghi trạng thái + event chờ vào outbox cùng `tx`. Lịch mới trùng lịch đang mở của cùng match (kể cả khi hai
   * request đồng thời) → `DATE_ALREADY_OPEN` (caller trả `Err` để UnitOfWork rollback). Xung đột version → throw.
   */
  save(tx: Tx, plan: DatePlan): Promise<Result<void, DatePlanSaveError>>;
  findById(tx: Tx, id: DatePlanId): Promise<DatePlan | null>;
  /** Khoá dòng tới hết `tx` (`SELECT … FOR UPDATE`) — tuần tự hoá phản hồi / huỷ / job hết hạn. */
  findByIdForUpdate(tx: Tx, id: DatePlanId): Promise<DatePlan | null>;
  /** Lịch đang mở (`PROPOSED | CONFIRMED | CHECKED_IN`) của match — tối đa một. */
  findOpenByMatch(tx: Tx, matchId: DatingMatchId): Promise<DatePlan | null>;
  /** Lịch mới đề xuất nhất của match (mọi trạng thái). */
  findLatestByMatch(tx: Tx, matchId: DatingMatchId): Promise<DatePlan | null>;
}
