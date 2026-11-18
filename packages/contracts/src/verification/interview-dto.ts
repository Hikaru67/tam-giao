import { z } from 'zod';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX } from '../http.js';

/**
 * DTO phỏng vấn sơ bộ 15 phút (BE-S3-05). Mỗi slot dài `INTERVIEW_DURATION_MINUTES` phút; huỷ/đổi lịch chỉ khi còn
 * ≥ `INTERVIEW_CHANGE_CUTOFF_HOURS` giờ trước giờ bắt đầu (`CANCEL_TOO_LATE`).
 */

export const INTERVIEW_SLOT_STATUS_VALUES = ['OPEN', 'BOOKED', 'COMPLETED'] as const;
export const INTERVIEW_OUTCOME_VALUES = ['PASSED', 'FAILED'] as const;

const limit = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT);
const instant = z.iso.datetime({ offset: true });

// ── Người dùng app ────────────────────────────────────────────────────────────────────────────────

/** `GET /me/kyc/interview/slots` — slot còn trống, bắt đầu sau `from` (mặc định: bây giờ), tăng dần theo giờ. */
export const interviewSlotsQuerySchema = z.object({ from: instant.optional(), limit });
export type InterviewSlotsQuery = z.infer<typeof interviewSlotsQuerySchema>;

/** Slot trống hiển thị cho người dùng — không có chuyên viên, không có link gọi video. */
export const availableInterviewSlotSchema = z.object({
  id: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export const availableInterviewSlotListResponseSchema = z.object({
  items: z.array(availableInterviewSlotSchema),
});
export type AvailableInterviewSlotListResponse = z.infer<typeof availableInterviewSlotListResponseSchema>;

/** `POST /me/kyc/interview` (đặt lịch) và `PUT /me/kyc/interview` (đổi sang slot khác). */
export const bookInterviewBodySchema = z.object({ slotId: z.uuid() });
export type BookInterviewBody = z.infer<typeof bookInterviewBodySchema>;

/**
 * `GET /me/kyc/interview` (và phản hồi đặt/đổi/huỷ) — lịch đang hoạt động của người dùng, `null` khi chưa có.
 * `changeDeadline` = mốc cuối còn được huỷ/đổi; `canChange` tính theo giờ server.
 */
export const myInterviewResponseSchema = z.object({
  booking: z
    .object({
      slotId: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      meetingUrl: z.string().nullable(),
      changeDeadline: z.iso.datetime(),
      canChange: z.boolean(),
    })
    .nullable(),
});
export type MyInterviewResponse = z.infer<typeof myInterviewResponseSchema>;

// ── Chuyên viên (admin, permission `kyc:review`) ──────────────────────────────────────────────────

/** `POST /admin/kyc/interview/slots` — mở slot; `meetingUrl` là link công cụ gọi video ngoài (tuỳ chọn). */
export const openInterviewSlotBodySchema = z.object({
  startsAt: instant,
  meetingUrl: z
    .url({ protocol: /^https?$/ })
    .max(500)
    .nullish(),
});
export type OpenInterviewSlotBody = z.infer<typeof openInterviewSlotBodySchema>;

/** `GET /admin/kyc/interview/slots` — nhật ký phỏng vấn, giảm dần theo giờ bắt đầu, lọc trạng thái/khoảng thời gian. */
export const adminInterviewSlotsQuerySchema = z
  .object({
    status: z.enum(INTERVIEW_SLOT_STATUS_VALUES).optional(),
    from: instant.optional(),
    to: instant.optional(),
    limit,
  })
  .refine((q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` phải trước `to`',
    path: ['from'],
  });
export type AdminInterviewSlotsQuery = z.infer<typeof adminInterviewSlotsQuerySchema>;

/** `PUT /admin/kyc/interview/:id/notes` — ghi nhận xét + đánh dấu bước `INTERVIEW` đạt/không đạt. */
export const recordInterviewResultBodySchema = z.object({
  outcome: z.enum(INTERVIEW_OUTCOME_VALUES),
  notes: z.string().trim().min(1).max(4000),
});
export type RecordInterviewResultBody = z.infer<typeof recordInterviewResultBodySchema>;

/** Slot đầy đủ cho chuyên viên. `notes` có thể chứa thông tin cá nhân — chỉ trả ở API admin. */
export const adminInterviewSlotSchema = z.object({
  id: z.uuid(),
  interviewerId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  meetingUrl: z.string().nullable(),
  status: z.enum(INTERVIEW_SLOT_STATUS_VALUES),
  bookedBy: z.uuid().nullable(),
  bookedAt: z.iso.datetime().nullable(),
  outcome: z.enum(INTERVIEW_OUTCOME_VALUES).nullable(),
  notes: z.string().nullable(),
  recordedBy: z.uuid().nullable(),
  recordedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type AdminInterviewSlot = z.infer<typeof adminInterviewSlotSchema>;

export const adminInterviewSlotListResponseSchema = z.object({ items: z.array(adminInterviewSlotSchema) });
export type AdminInterviewSlotListResponse = z.infer<typeof adminInterviewSlotListResponseSchema>;
