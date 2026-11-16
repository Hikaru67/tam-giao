import { z } from 'zod';

/** SĐT do người dùng nhập (0912…, 84912…, +84912…); server chuẩn hoá về E.164 và trả `PHONE_INVALID` nếu sai. */
const phoneInput = z.string().trim().min(9).max(20);

export const requestOtpBodySchema = z.object({ phone: phoneInput });
export type RequestOtpBody = z.infer<typeof requestOtpBodySchema>;

export const requestOtpResponseSchema = z.object({
  /** OTP có hiệu lực trong bao nhiêu giây. */
  expiresInSeconds: z.number().int().positive(),
  /** Sau bao nhiêu giây mới được yêu cầu gửi lại. */
  resendAfterSeconds: z.number().int().positive(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

export const verifyOtpBodySchema = z.object({
  phone: phoneInput,
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;

export const verifyOtpResponseSchema = z.object({
  userId: z.uuid(),
  /** true nếu tài khoản vừa được tạo ở lần xác thực này. */
  isNewUser: z.boolean(),
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;
