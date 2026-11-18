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
