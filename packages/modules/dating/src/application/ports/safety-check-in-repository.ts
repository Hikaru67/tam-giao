import type { Result, Tx } from '@tamgiao/kernel';
import type { DatePlanId, DatingUserId } from '../../domain/date-plan.js';
import type { GeoPoint } from '../../domain/geo-point.js';
import type { AlreadyCheckedIn, SafetyCheckIn, SafetyCheckInId } from '../../domain/safety-check-in.js';

/**
 * Lưu trữ aggregate `SafetyCheckIn` (`dating.safety_check_ins`) + outbox, trong `tx` của caller (A5, A6). Mỗi
 * (`date_plan_id`, `user_id`) tối đa một bản ghi — unique ở DB (A10).
 */
export interface SafetyCheckInRepository {
  /**
   * Ghi trạng thái + event chờ vào outbox cùng `tx` (version lạc quan như `DatePlanRepository`). Bản ghi mới trùng
   * (lịch, người) — kể cả hai request đồng thời — → `DATE_ALREADY_CHECKED_IN` (caller trả `Err` để rollback). Xung đột
   * version → throw.
   */
  save(tx: Tx, checkIn: SafetyCheckIn): Promise<Result<void, AlreadyCheckedIn>>;
  findByPlanAndUser(tx: Tx, datePlanId: DatePlanId, userId: DatingUserId): Promise<SafetyCheckIn | null>;
  /** `SELECT … FOR UPDATE` — tuần tự hoá check-out với job quá hạn. */
  findByPlanAndUserForUpdate(
    tx: Tx,
    datePlanId: DatePlanId,
    userId: DatingUserId,
  ): Promise<SafetyCheckIn | null>;
  /** `SELECT … FOR UPDATE` — job quá hạn. */
  findByIdForUpdate(tx: Tx, id: SafetyCheckInId): Promise<SafetyCheckIn | null>;
}

/**
 * Vị trí thô gửi kèm check-in (`dating.check_in_locations`). Adapter mã hoá qua `Encryptor` (context gắn với
 * `checkInId`); chỉ ghi và xoá — không có đường đọc cho người dùng app.
 */
export interface CheckInLocationStore {
  /** Ghi vị trí cho check-in (một vị trí / check-in), hết hạn lưu lúc `purgeAfter`. */
  record(
    tx: Tx,
    input: {
      readonly checkInId: SafetyCheckInId;
      readonly location: GeoPoint;
      readonly recordedAt: Date;
      readonly purgeAfter: Date;
    },
  ): Promise<void>;
  /** Xoá (DELETE) mọi vị trí có `purge_after <= now`; trả số dòng đã xoá. Idempotent. */
  purgeExpired(tx: Tx, now: Date): Promise<number>;
}
