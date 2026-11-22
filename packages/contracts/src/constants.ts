/**
 * Hằng số nghiệp vụ — nguồn chân lý duy nhất (AGENTS.md mục 6). Không hardcode các giá trị này ở nơi khác.
 * File này thuần TypeScript (không Zod) để domain/application được phép import (AGENTS.md A1).
 * Đổi giá trị ở đây phải đổi bảng trong AGENTS.md (test `constants.test.ts` kiểm tra hai nơi khớp nhau).
 */

/** Thời gian suy nghĩ gợi ý (OFFERED). */
export const OFFER_TTL_HOURS = 24;
/** Chờ đối phương phản hồi (AWAITING_RESPONSE). */
export const RESPONSE_TTL_HOURS = 24;
/** Giai đoạn tìm hiểu độc quyền. */
export const DATING_DAYS = 14;
/** Nghỉ sau khi dừng tìm hiểu. */
export const COOLDOWN_DAYS = 7;
/** Khoản thu khi xác thực (tên gọi chờ quyết định D1). */
export const DEPOSIT_VND = 299_000;
/** Voucher hẹn hò tặng kèm. */
export const VOUCHER_VND = 300_000;
/** Hạn voucher kể từ khi hồ sơ được duyệt. */
export const VOUCHER_TTL_DAYS = 90;
/** Hoàn tiền khi hồ sơ không được duyệt. */
export const REFUND_SLA_HOURS = 48;
export const OTP_TTL_SECONDS = 120;
export const OTP_MAX_ATTEMPTS = 5;
export const PRESIGNED_URL_TTL_SECONDS = 300;
export const MAX_PROFILE_PHOTOS = 5;
/** Chuyên viên phản hồi báo cáo khẩn cấp. */
export const SAFETY_RESPONSE_SLA_MINUTES = 30;
/** Chờ xác nhận (D6). */
export const MIN_AGE = 20;
/** Chờ xác nhận (D6). */
export const KYC_MEDIA_RETENTION_DAYS = 30;
/** Thời lượng một slot phỏng vấn sơ bộ (BE-S3-05). */
export const INTERVIEW_DURATION_MINUTES = 15;
/** Huỷ/đổi lịch phỏng vấn chỉ khi còn ít nhất ngần này giờ trước giờ bắt đầu (BE-S3-05). */
export const INTERVIEW_CHANGE_CUTOFF_HOURS = 2;
/** Độ dài tối đa (ký tự Unicode, sau khi bỏ khoảng trắng hai đầu) của một tin nhắn chat (BE-S6-01). */
export const MESSAGE_MAX_LENGTH = 2_000;
/** Số tin tối đa một người gửi được trong 60 giây gần nhất của một hội thoại (BE-S6-01). */
export const MESSAGE_RATE_LIMIT_PER_MINUTE = 30;
/** Nhắc "gợi ý sắp hết hạn" khi còn ngần này giờ trước hạn phản hồi gợi ý (BE-S7-05). */
export const OFFER_EXPIRY_REMINDER_HOURS = 2;
/** Nhắc lịch hẹn gặp mặt trước giờ hẹn ngần này giờ (BE-S7-05). */
export const DATE_REMINDER_HOURS = 2;
/** Người được mời xác nhận lịch hẹn trong ngần này giờ kể từ lúc đề xuất, quá hạn → `EXPIRED` (BE-S7-01). */
export const DATE_RESPONSE_TTL_HOURS = 24;
/** Huỷ lịch hẹn đã xác nhận chỉ khi còn ít nhất ngần này giờ trước giờ bắt đầu (BE-S7-01). */
export const DATE_CANCEL_CUTOFF_HOURS = 4;
/** Nhắc "Mục tiêu: gặp mặt trước ngày `DATING_DAYS`" lần 1 vào ngày thứ ngần này của giai đoạn tìm hiểu (BE-S7-04). */
export const DATING_FIRST_REMINDER_DAY = 7;
/** Nhắc lần 2 (sắp hết giai đoạn tìm hiểu) vào ngày thứ ngần này (BE-S7-04). */
export const DATING_FINAL_REMINDER_DAY = 12;
/** Quá giờ kết thúc buổi hẹn ngần này phút mà người đã check-in an toàn chưa check-out → cảnh báo chuyên viên (BE-S7-02). */
export const CHECK_IN_OVERDUE_MINUTES = 60;
/** Vị trí thô gửi kèm check-in an toàn bị xoá sau ngần này giờ kể từ lúc ghi nhận (BE-S7-02). */
export const CHECK_IN_LOCATION_RETENTION_HOURS = 24;
