import { z } from 'zod';
import { DATE_PLAN_STATUS_NAMES } from './events.js';

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
