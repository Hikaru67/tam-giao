import { z } from 'zod';
import { ADMIN_PERMISSIONS, ADMIN_ROLES } from './permissions.js';

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

export const adminLoginBodySchema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
  /** Mã 6 số từ app Authenticator; thiếu → 401 `MFA_REQUIRED`. */
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  /** "Ghi nhớ thiết bị": phiên 12 giờ thay vì 8 giờ. */
  rememberDevice: z.boolean().optional(),
});
export type AdminLoginBody = z.infer<typeof adminLoginBodySchema>;

export const adminProfileSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: z.enum(ADMIN_ROLES),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)),
});

export const adminLoginResponseSchema = z.object({
  /** Token phiên, gửi ở header `Authorization: Bearer <token>`. */
  token: z.string(),
  expiresAt: z.iso.datetime(),
  admin: adminProfileSchema,
});
export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

export const adminMeResponseSchema = z.object({
  adminId: z.uuid(),
  role: z.enum(ADMIN_ROLES),
  permissions: z.array(z.enum(ADMIN_PERMISSIONS)),
});
export type AdminMeResponse = z.infer<typeof adminMeResponseSchema>;

/** `GET /admin/audit-logs` (permission `audit:read`) — lọc theo actor / target / thời gian. */
export const auditLogQuerySchema = z
  .object({
    actorType: z.enum(['admin', 'user', 'system']).optional(),
    actorId: z.uuid().optional(),
    action: z.string().min(1).max(100).optional(),
    targetType: z.string().min(1).max(50).optional(),
    targetId: z.string().min(1).max(100).optional(),
    /** Bao gồm mốc này (ISO 8601). */
    from: z.iso.datetime({ offset: true }).optional(),
    /** Không bao gồm mốc này (ISO 8601). */
    to: z.iso.datetime({ offset: true }).optional(),
    /** `nextCursor` của trang trước. */
    cursor: z.string().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || Date.parse(q.from) < Date.parse(q.to), {
    message: '`from` phải trước `to`',
    path: ['to'],
  });
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogEntrySchema = z.object({
  id: z.uuid(),
  occurredAt: z.iso.datetime(),
  actor: z.object({ type: z.enum(['admin', 'user', 'system']), id: z.uuid().nullable() }),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  ip: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogListResponseSchema = z.object({
  items: z.array(auditLogEntrySchema),
  /** `null` khi hết dữ liệu. */
  nextCursor: z.string().nullable(),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;
