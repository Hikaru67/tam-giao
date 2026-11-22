import { z } from 'zod';
import { CHECK_IN_SOURCE_NAMES, DATE_PLAN_STATUS_NAMES } from './events.js';

/**
 * DTO đặt lịch gặp mặt tại quán đối tác (BE-S7-01, màn "Đặt lịch Gặp mặt & Điểm hẹn An toàn"). Thời gian ISO 8601;
 * server lưu UTC.
 */

const instant = z.iso.datetime({ offset: true });

/**
 * `POST /me/dates` — người mời chọn quán (đang hoạt động, xem `GET /partners`), ngày + khung giờ (`startsAt` →
 * `endsAt`), tuỳ chọn "Chuyên viên xác nhận đặt bàn". Match của người dùng phải đang `DATING`.
 */
export const proposeDateBodySchema = z.object({
  partnerId: z.uuid(),
  startsAt: instant,
  endsAt: instant,
  staffBookingRequested: z.boolean().default(false),
});
export type ProposeDateBody = z.infer<typeof proposeDateBodySchema>;

export const DATE_PLAN_ROLE_NAMES = ['INVITER', 'INVITEE'] as const;

/** Lịch hẹn nhìn từ người xem (một trong hai người của cặp). */
export const datePlanSchema = z.object({
  id: z.uuid(),
  matchId: z.uuid(),
  inviterId: z.uuid(),
  inviteeId: z.uuid(),
  /** Vai trò của người xem. */
  myRole: z.enum(DATE_PLAN_ROLE_NAMES),
  partnerId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  staffBookingRequested: z.boolean(),
  status: z.enum(DATE_PLAN_STATUS_NAMES),
  /** Hạn xác nhận (chỉ có ý nghĩa khi `PROPOSED`). */
  expiresAt: z.iso.datetime(),
  proposedAt: z.iso.datetime(),
  /** Lúc người được mời xác nhận / từ chối. */
  respondedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  cancelledBy: z.uuid().nullable(),
  /** Mốc cuối còn được huỷ lịch đã xác nhận (`startsAt − DATE_CANCEL_CUTOFF_HOURS`). */
  cancelDeadline: z.iso.datetime(),
});
export type DatePlanDto = z.infer<typeof datePlanSchema>;

/**
 * `GET /me/dates/current` — lịch mới nhất của match đang mở của người xem (mọi trạng thái, để FE biết lịch vừa
 * `EXPIRED`/`DECLINED` và mời đề xuất lại); `null` khi không có match mở hoặc chưa có lịch.
 */
export const currentDatePlanResponseSchema = z.object({ datePlan: datePlanSchema.nullable() });
export type CurrentDatePlanResponse = z.infer<typeof currentDatePlanResponseSchema>;

/**
 * `POST /me/dates/:id/check-in` (BE-S7-02) — toggle "Check-in an toàn: gửi vị trí cho chuyên viên". `location` tuỳ chọn
 * (vị trí thô một lần, không theo dõi liên tục); chỉ nhận trong khung giờ hẹn, tự xoá sau
 * `CHECK_IN_LOCATION_RETENTION_HOURS` giờ.
 */
export const checkInLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Bán kính sai số (mét) do thiết bị báo, tuỳ chọn. */
  accuracyMeters: z.number().nonnegative().max(100_000).optional(),
});
/** Không gửi vị trí → body `{}`. */
export const checkInBodySchema = z.object({ location: checkInLocationSchema.optional() });
export type CheckInBody = z.infer<typeof checkInBodySchema>;

/** Trạng thái check-in an toàn của người xem cho một lịch hẹn. Không trả lại vị trí. */
export const safetyCheckInSchema = z.object({
  id: z.uuid(),
  datePlanId: z.uuid(),
  source: z.enum(CHECK_IN_SOURCE_NAMES),
  checkedInAt: z.iso.datetime(),
  /** Quá mốc này chưa check-out → cảnh báo chuyên viên. */
  overdueAt: z.iso.datetime(),
  checkedOutAt: z.iso.datetime().nullable(),
  overdueAlertedAt: z.iso.datetime().nullable(),
  locationShared: z.boolean(),
});
export type SafetyCheckInDto = z.infer<typeof safetyCheckInSchema>;

/** `GET /me/dates/:id/check-in` — `null` khi người xem chưa check-in lịch này. */
export const myCheckInResponseSchema = z.object({ checkIn: safetyCheckInSchema.nullable() });
export type MyCheckInResponse = z.infer<typeof myCheckInResponseSchema>;
