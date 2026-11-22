import { z } from 'zod';

/**
 * DTO đánh giá kín sau buổi gặp (BE-S7-03, màn "Đánh Giá Sau Gặp Mặt & Quyết Định Hẹn Hò"). Câu trả lời **chỉ
 * chuyên viên thấy** — API người dùng chỉ trả đánh giá của chính người xem, không bao giờ trả của đối phương.
 * Hằng số khớp domain dating (`date-feedback.ts`) — test `dating-contracts.test.ts` đối chiếu.
 */

/** Sao ấn tượng về đối phương (1 = "Chưa phù hợp" … 5 = "Rất xuất sắc & Lịch thiệp"). */
export const FEEDBACK_RATING_MIN = 1;
export const FEEDBACK_RATING_MAX = 5;
/** Độ dài tối đa "Lý do khác hoặc chia sẻ thêm" (ký tự, sau khi trim). */
export const FEEDBACK_NOTE_MAX_LENGTH = 1000;

/** Ngoại hình & phong thái so với hồ sơ eKYC: "100% khớp" | "Khá tương đồng" | "Có khác biệt" (→ cờ cho chuyên viên). */
export const FEEDBACK_PROFILE_MATCH_NAMES = ['FULL_MATCH', 'MOSTLY_MATCH', 'DIFFERENT'] as const;
/** Cảm xúc kết nối: "Rất muốn tìm hiểu sâu hơn" | "Cần thêm thời gian quan sát" | "Cảm thấy chưa phù hợp". */
export const FEEDBACK_FEELING_NAMES = ['DEEP_INTEREST', 'NEED_MORE_TIME', 'NOT_A_FIT'] as const;
/** Quyết định: A — tiến tới cam kết gắn kết; B — dừng tìm hiểu văn minh (cooldown `COOLDOWN_DAYS`). */
export const FEEDBACK_DECISION_NAMES = ['A_COMMIT', 'B_STOP'] as const;
/** Lý do kín khi chọn B: lối sống & thói quen | chưa có rung động | kế hoạch tài chính / gia đình. */
export const FEEDBACK_STOP_REASON_NAMES = [
  'LIFESTYLE_DIFFERENCE',
  'NO_SPARK',
  'FINANCE_FAMILY_PLAN_DIFFERENCE',
] as const;

/**
 * `POST /me/dates/:id/feedback` — một trong hai người của lịch hẹn đã diễn ra (đã xác nhận và tới giờ hẹn). Lý do kín
 * (`stopReasons`, `stopNote`) chỉ đi kèm `B_STOP`; domain kiểm tra lại toàn bộ luật.
 */
export const submitFeedbackBodySchema = z.object({
  rating: z.number().int().min(FEEDBACK_RATING_MIN).max(FEEDBACK_RATING_MAX),
  profileMatch: z.enum(FEEDBACK_PROFILE_MATCH_NAMES),
  feeling: z.enum(FEEDBACK_FEELING_NAMES),
  decision: z.enum(FEEDBACK_DECISION_NAMES),
  stopReasons: z.array(z.enum(FEEDBACK_STOP_REASON_NAMES)).max(FEEDBACK_STOP_REASON_NAMES.length).default([]),
  /** Chặn thô kích thước body; domain kiểm tra chính xác (sau trim, đếm code point) → `FEEDBACK_INVALID`. */
  stopNote: z
    .string()
    .max(FEEDBACK_NOTE_MAX_LENGTH * 2)
    .nullable()
    .default(null),
});
export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBodySchema>;

/** Đánh giá của **chính người xem** (không có thông tin đối phương đã gửi hay chưa). */
export const myFeedbackSchema = z.object({
  id: z.uuid(),
  datePlanId: z.uuid(),
  matchId: z.uuid(),
  rating: z.number().int(),
  profileMatch: z.enum(FEEDBACK_PROFILE_MATCH_NAMES),
  feeling: z.enum(FEEDBACK_FEELING_NAMES),
  decision: z.enum(FEEDBACK_DECISION_NAMES),
  stopReasons: z.array(z.enum(FEEDBACK_STOP_REASON_NAMES)),
  stopNote: z.string().nullable(),
  submittedAt: z.iso.datetime(),
});
export type MyFeedbackDto = z.infer<typeof myFeedbackSchema>;

/** `GET /me/dates/:id/feedback` — `{feedback: null}` khi người xem chưa gửi. */
export const myFeedbackResponseSchema = z.object({ feedback: myFeedbackSchema.nullable() });
export type MyFeedbackResponse = z.infer<typeof myFeedbackResponseSchema>;

/** `GET /admin/dating/appearance-flags` — hàng chờ cờ "Có khác biệt so với eKYC" (mới nhất trước). */
export const appearanceFlagQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});
export type AppearanceFlagQueueQuery = z.infer<typeof appearanceFlagQueueQuerySchema>;

/** Một cờ trong hàng chờ — chỉ id + mốc thời gian, không nội dung đánh giá (xem chi tiết mới ghi audit). */
export const appearanceFlagSchema = z.object({
  feedbackId: z.uuid(),
  matchId: z.uuid(),
  datePlanId: z.uuid(),
  /** Người gửi đánh giá. */
  authorId: z.uuid(),
  /** Người bị đánh giá "Có khác biệt" — chuyên viên đối soát với hồ sơ eKYC của người này. */
  subjectId: z.uuid(),
  submittedAt: z.iso.datetime(),
});
export const appearanceFlagQueueResponseSchema = z.object({
  total: z.number().int(),
  items: z.array(appearanceFlagSchema),
});
export type AppearanceFlagQueueResponse = z.infer<typeof appearanceFlagQueueResponseSchema>;

/** `GET /admin/dating/feedbacks/:id` — toàn bộ đánh giá (kể cả lý do kín); mỗi lần xem ghi audit. */
export const adminFeedbackDetailSchema = myFeedbackSchema.extend({
  authorId: z.uuid(),
  subjectId: z.uuid(),
});
export type AdminFeedbackDetailResponse = z.infer<typeof adminFeedbackDetailSchema>;
