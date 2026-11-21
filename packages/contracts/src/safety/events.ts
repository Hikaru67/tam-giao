/**
 * Event payload của aggregate `Report` (module safety, BE-S6-05), phát qua outbox. Không chứa PII: chỉ id, mã phân
 * loại, cờ, thời gian. Mô tả báo cáo (văn bản tự do) và key ảnh bằng chứng KHÔNG nằm trong event. Thời gian ISO 8601 UTC.
 */

/** Loại vi phạm — khớp `REPORT_CATEGORIES` của domain safety (có test đối chiếu). */
export const REPORT_CATEGORY_NAMES = [
  'MARITAL_FRAUD',
  'FINANCIAL_SCAM',
  'HARASSMENT',
  'NO_SHOW_DISRESPECT',
] as const;
export type ReportCategoryName = (typeof REPORT_CATEGORY_NAMES)[number];

/** Mức độ nghiêm trọng (tăng dần) — khớp `REPORT_SEVERITIES` của domain safety. */
export const REPORT_SEVERITY_NAMES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type ReportSeverityName = (typeof REPORT_SEVERITY_NAMES)[number];

/** Trạng thái xử lý: `OPEN → IN_REVIEW → RESOLVED | DISMISSED` — khớp `REPORT_STATUSES` của domain safety. */
export const REPORT_STATUS_NAMES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatusName = (typeof REPORT_STATUS_NAMES)[number];

/**
 * Người dùng gửi báo cáo vi phạm. Tiêu thụ: matching khoá match (`LockMatch` → `LOCKED`, `MatchLocked`), messaging đóng
 * hội thoại (qua `MatchLocked`), notification cảnh báo chuyên viên. `matchId` = match gần nhất giữa hai người (cặp
 * đang/đã từng ghép). `dueAt` = hạn chuyên viên phản hồi khi chọn "Chuyên viên can thiệp khẩn cấp"
 * (`SAFETY_RESPONSE_SLA_MINUTES`), `null` nếu không chọn.
 */
export const REPORT_FILED = 'ReportFiled';
export interface ReportFiledPayload {
  readonly reportId: string;
  readonly reporterId: string;
  readonly reportedUserId: string;
  readonly matchId: string;
  readonly category: ReportCategoryName;
  readonly severity: ReportSeverityName;
  readonly urgent: boolean;
  readonly dueAt: string | null;
}

/** Chuyên viên đổi trạng thái xử lý báo cáo (nhận xử lý, kết luận, bác bỏ — route ở BE-S6-06). */
export const REPORT_STATUS_CHANGED = 'ReportStatusChanged';
export interface ReportStatusChangedPayload {
  readonly reportId: string;
  readonly fromStatus: ReportStatusName;
  readonly toStatus: ReportStatusName;
}
