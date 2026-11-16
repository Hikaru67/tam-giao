/** Giới hạn tần suất: tối đa `limit` lần trong `windowSeconds` giây gần nhất. */
export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

export const OTP_LENGTH = 6;

/** Khoảng chờ tối thiểu giữa hai lần yêu cầu OTP (BE-S2-01: 1 OTP/60s). */
export const OTP_RESEND_AFTER_SECONDS = 60;

/** BE-S2-01: 1 OTP/60s và 5 OTP/giờ — áp dụng riêng cho từng SĐT và từng IP. */
export const OTP_REQUEST_LIMITS: readonly RateLimitRule[] = [
  { limit: 1, windowSeconds: OTP_RESEND_AFTER_SECONDS },
  { limit: 5, windowSeconds: 3_600 },
];
