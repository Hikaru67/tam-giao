import { z } from 'zod';
import { REPORT_CATEGORY_NAMES, REPORT_SEVERITY_NAMES, REPORT_STATUS_NAMES } from './events.js';

/**
 * DTO màn "Báo cáo Vi phạm & Trung tâm An toàn Khẩn cấp" (BE-S6-05). Mô tả là văn bản tự do (có thể chứa PII) —
 * không log. Hai giới hạn dưới đây khớp hằng số của domain safety (có test đối chiếu).
 */

/** Độ dài tối đa mô tả diễn biến (màn thiết kế: "0 / 1000"). */
export const REPORT_DESCRIPTION_MAX_LENGTH = 1000;
/** Số ảnh bằng chứng tối đa (màn thiết kế: "Tối đa 5 ảnh"). */
export const REPORT_MAX_EVIDENCE = 5;

/**
 * `POST /me/reports`. `evidenceKeys` là key upload mục đích `report_evidence` (bucket private) của chính người báo
 * cáo (`POST /uploads` trước). `urgentIntervention` = "Chuyên viên can thiệp khẩn cấp".
 */
export const fileReportBodySchema = z.object({
  reportedUserId: z.uuid(),
  category: z.enum(REPORT_CATEGORY_NAMES),
  description: z.string().max(REPORT_DESCRIPTION_MAX_LENGTH).nullish(),
  evidenceKeys: z.array(z.string().min(1).max(512)).max(REPORT_MAX_EVIDENCE).optional(),
  urgentIntervention: z.boolean().optional(),
});
export type FileReportBody = z.infer<typeof fileReportBodySchema>;

/** 201 — báo cáo đã ghi nhận (`OPEN`); match giữa hai người bị khoá bất đồng bộ qua event `ReportFiled`. */
export const fileReportResponseSchema = z.object({
  reportId: z.uuid(),
  status: z.enum(REPORT_STATUS_NAMES),
  category: z.enum(REPORT_CATEGORY_NAMES),
  severity: z.enum(REPORT_SEVERITY_NAMES),
  urgent: z.boolean(),
  /** Hạn chuyên viên phản hồi (`SAFETY_RESPONSE_SLA_MINUTES`) khi `urgent`, ngược lại `null`. */
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type FileReportResponse = z.infer<typeof fileReportResponseSchema>;
