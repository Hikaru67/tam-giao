import { z } from 'zod';
import { REPORT_CATEGORY_NAMES, REPORT_SEVERITY_NAMES, REPORT_STATUS_NAMES } from './events.js';

/**
 * DTO admin kiểm duyệt (BE-S6-06): "Báo cáo Vi phạm & Khiếu nại" + thẻ "Cảnh báo vi phạm". Mọi route dùng permission
 * `safety:ban`. Response chi tiết chứa PII (mô tả, kết luận, nội dung tin, link ảnh) — không log.
 */

/** Độ dài tối đa kết luận xử lý báo cáo — khớp domain safety (có test đối chiếu). */
export const REPORT_CONCLUSION_MAX_LENGTH = 2000;
/** Độ dài tối đa lý do khoá tài khoản — khớp domain safety (có test đối chiếu). */
export const BAN_REASON_MAX_LENGTH = 1000;

/** `GET /admin/reports?status=OPEN,IN_REVIEW&limit=&offset=` — bỏ trống `status` = `OPEN,IN_REVIEW`. */
export const reportQueueQuerySchema = z.object({
  status: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    )
    .pipe(z.array(z.enum(REPORT_STATUS_NAMES)).min(1))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
export type ReportQueueQuery = z.infer<typeof reportQueueQuerySchema>;

const reportBaseSchema = z.object({
  reportId: z.uuid(),
  reporterId: z.uuid(),
  reportedUserId: z.uuid(),
  matchId: z.uuid(),
  category: z.enum(REPORT_CATEGORY_NAMES),
  severity: z.enum(REPORT_SEVERITY_NAMES),
  status: z.enum(REPORT_STATUS_NAMES),
  urgent: z.boolean(),
  dueAt: z.iso.datetime().nullable(),
  /** Quá SLA: có hạn, chưa đóng, `dueAt` đã qua. */
  overdue: z.boolean(),
  handledBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

/** Hàng chờ: `severity` giảm dần, rồi `dueAt` tăng dần (không hạn đứng cuối). */
export const reportQueueResponseSchema = z.object({
  items: z.array(reportBaseSchema),
  total: z.number().int().min(0),
});
export type ReportQueueResponse = z.infer<typeof reportQueueResponseSchema>;

/** `GET /admin/reports/:id` — mỗi lần gọi ghi audit `safety.report.view_detail`. */
export const reportDetailResponseSchema = reportBaseSchema.extend({
  description: z.string().nullable(),
  /** Presigned GET bucket private, hết hạn ≤ `PRESIGNED_URL_TTL_SECONDS`. */
  evidence: z.array(z.object({ key: z.string(), url: z.string(), expiresAt: z.iso.datetime() })),
  conclusion: z.string().nullable(),
  closedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  version: z.number().int(),
});
export type ReportDetailResponse = z.infer<typeof reportDetailResponseSchema>;

/** `POST /admin/reports/:id/resolve` — `RESOLVED` (có vi phạm) hoặc `DISMISSED` (bác bỏ), kết luận bắt buộc. */
export const resolveReportBodySchema = z.object({
  outcome: z.enum(['RESOLVED', 'DISMISSED']),
  conclusion: z.string().trim().min(1).max(REPORT_CONCLUSION_MAX_LENGTH),
});
export type ResolveReportBody = z.infer<typeof resolveReportBodySchema>;

/** Kết quả `POST /admin/reports/:id/start-review` và `…/resolve`. */
export const reportActionResponseSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(REPORT_STATUS_NAMES),
  handledBy: z.uuid().nullable(),
  closedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ReportActionResponse = z.infer<typeof reportActionResponseSchema>;

/** `GET /admin/flagged-messages?cursor=&limit=` — mới nhất trước. */
export const flaggedMessageQueueQuerySchema = z.object({
  /** `nextCursor` của trang trước. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type FlaggedMessageQueueQuery = z.infer<typeof flaggedMessageQueueQuerySchema>;

const flaggedMessageBaseSchema = z.object({
  messageId: z.uuid(),
  conversationId: z.uuid(),
  matchId: z.uuid(),
  senderId: z.uuid(),
  recipientId: z.uuid(),
  /** Mã luật bộ lọc lừa đảo (BE-S6-03). */
  reasons: z.array(z.string()),
  sentAt: z.iso.datetime(),
});

/** Danh sách không có nội dung tin (không ghi audit). */
export const flaggedMessageQueueResponseSchema = z.object({
  items: z.array(flaggedMessageBaseSchema),
  nextCursor: z.string().nullable(),
});
export type FlaggedMessageQueueResponse = z.infer<typeof flaggedMessageQueueResponseSchema>;

/** `GET /admin/flagged-messages/:id` — có nội dung tin, mỗi lần gọi ghi audit `safety.flagged_message.view_detail`. */
export const flaggedMessageDetailResponseSchema = flaggedMessageBaseSchema.extend({
  body: z.string(),
  maskedBody: z.string().nullable(),
});
export type FlaggedMessageDetailResponse = z.infer<typeof flaggedMessageDetailResponseSchema>;

/** `POST /admin/users/:id/ban` — khoá vĩnh viễn; lý do bắt buộc. `reportId` = báo cáo về chính người này (tuỳ chọn). */
export const banUserBodySchema = z.object({
  reason: z.string().trim().min(1).max(BAN_REASON_MAX_LENGTH),
  reportId: z.uuid().nullish(),
});
export type BanUserBody = z.infer<typeof banUserBodySchema>;

/** 201 — đã khoá; hiệu ứng (thu hồi phiên, loại khỏi ghép đôi, khoá match) chạy bất đồng bộ qua `UserBanned`. */
export const banUserResponseSchema = z.object({
  banId: z.uuid(),
  userId: z.uuid(),
  reportId: z.uuid().nullable(),
  bannedBy: z.uuid(),
  bannedAt: z.iso.datetime(),
});
export type BanUserResponse = z.infer<typeof banUserResponseSchema>;
