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
  /** Tên thiết bị để hiển thị ở danh sách thiết bị đăng nhập (vd "iPhone 15"). */
  deviceName: z.string().trim().min(1).max(100).optional(),
});
export type VerifyOtpBody = z.infer<typeof verifyOtpBodySchema>;

export const authTokensSchema = z.object({
  sessionId: z.uuid(),
  /** JWT, gửi ở header `Authorization: Bearer <accessToken>`. */
  accessToken: z.string(),
  accessTokenExpiresInSeconds: z.number().int().positive(),
  /** Dùng một lần ở `POST /auth/refresh`; mỗi lần refresh trả về token mới. */
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const verifyOtpResponseSchema = z.object({
  userId: z.uuid(),
  /** true nếu tài khoản vừa được tạo ở lần xác thực này. */
  isNewUser: z.boolean(),
  tokens: authTokensSchema,
});
export type VerifyOtpResponse = z.infer<typeof verifyOtpResponseSchema>;

export const refreshSessionBodySchema = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshSessionBody = z.infer<typeof refreshSessionBodySchema>;

export const deviceSessionSchema = z.object({
  id: z.uuid(),
  deviceName: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** Phiên của thiết bị đang gọi API. */
  current: z.boolean(),
});
export const listSessionsResponseSchema = z.object({ items: z.array(deviceSessionSchema) });
export type ListSessionsResponse = z.infer<typeof listSessionsResponseSchema>;
